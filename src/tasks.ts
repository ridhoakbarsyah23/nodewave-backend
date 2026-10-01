import { Hono } from 'hono'
import { PrismaClient, Role, TaskStatus } from '@prisma/client'
import { authMiddleware } from './middleware/auth'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { buildFilterQuery } from '@nodewave/prisma-ezfilter'

const prisma = new PrismaClient()
const tasksApp = new Hono<{
  Variables: {
    jwtPayload: {
      sub: string
      role: Role
      department?: string
    }
  }
}>()

tasksApp.use('/*', authMiddleware)

// Helper to record audit log
async function createAuditLog(
  tx: any,
  taskId: string,
  userId: string,
  column: string,
  oldVal: string,
  newVal: string
) {
  await tx.auditLog.create({
    data: {
      taskId,
      userId,
      changedColumn: column,
      oldValue: oldVal,
      newValue: newVal,
    },
  })
}

// GET /api/tasks
tasksApp.get('/', async (c) => {
  const user = c.get('jwtPayload')
  
  // Base query construction
  let whereClause: any = { deletedAt: null }

  if (user.role === Role.INTERNAL) {
    // Internal: Can only view tasks on projects they are assigned to.
    const userTasks = await prisma.task.findMany({
      where: { assigneeId: user.sub, deletedAt: null },
      select: { projectId: true },
    })
    const projectIds = [...new Set(userTasks.map((t) => t.projectId))]
    whereClause.projectId = { in: projectIds }
  } else if (user.role === Role.CLIENT) {
    // Client: Can only see tasks explicitly flagged as Client-Visible
    whereClause.clientVisible = true
  }

  const query = c.req.query()
  const filterParams = buildFilterQuery(query, {})

  const tasks = await prisma.task.findMany({
    where: { ...whereClause, ...filterParams.where },
    include: {
      assignee: true,
      prerequisites: {
        include: { prerequisite: true }
      }
    },
    orderBy: filterParams.orderBy,
    skip: filterParams.skip,
    take: filterParams.take,
  })

  // Data Masking for Client Guest
  const formattedTasks = tasks.map(task => {
    if (user.role === Role.CLIENT) {
      return {
        ...task,
        assigneeId: null,
        assignee: null,
        // Any other internal fields to mask could go here
      }
    }
    return task
  })

  // For Client Guest, aggregate metrics (e.g., of their projects)
  // Let's assume all tasks returned belong to their project(s).
  const total = formattedTasks.length
  const completed = formattedTasks.filter(t => t.status === 'DONE').length
  
  return c.json({
    aggregate: {
      completionRate: total === 0 ? '0%' : `${Math.round((completed / total) * 100)}%`
    },
    data: formattedTasks
  })
})

// PATCH /api/tasks/:id/status
const updateStatusSchema = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']),
  version: z.number().int()
})

tasksApp.patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const user = c.get('jwtPayload')
  const taskId = c.req.param('id')
  const { status, version } = c.req.valid('json')

  return await prisma.$transaction(async (tx) => {
    // Find the task
    const task = await tx.task.findUnique({
      where: { id: taskId, deletedAt: null },
      include: { prerequisites: { include: { prerequisite: true } } }
    })

    if (!task) return c.json({ error: 'Task not found' }, 404)
    
    // Concurrency & Optimistic Locking check
    if (task.version !== version) {
      return c.json({ error: 'Data Concurrency Conflict: Task has been modified by someone else.' }, 409)
    }

    // State-Based Permissions
    if (user.role === Role.PM) {
      if (task.status === TaskStatus.IN_PROGRESS && status === TaskStatus.DONE) {
        return c.json({ error: 'PMs cannot move a task from In Progress to Done. Only the executor can complete it.' }, 403)
      }
    } else if (user.role === Role.INTERNAL) {
      // Internal team changing to IN_PROGRESS needs all prerequisites to be DONE
      if (status === TaskStatus.IN_PROGRESS) {
        const hasIncompletePrereqs = task.prerequisites.some(
          (p) => p.prerequisite.status !== TaskStatus.DONE
        )
        if (hasIncompletePrereqs) {
          return c.json({ error: 'Prerequisite tasks are not completed yet.' }, 403)
        }
      }
      
      // Only the executor can complete it
      if (status === TaskStatus.DONE && task.assigneeId !== user.sub) {
        return c.json({ error: 'Only the assignee can mark this task as Done.' }, 403)
      }
    }

    // Perform the update
    const updatedTask = await tx.task.update({
      where: { id: taskId, version: version }, // Double enforcement of optimistic lock
      data: {
        status,
        version: { increment: 1 }
      }
    })

    // Record Audit Trail
    await createAuditLog(
      tx,
      taskId,
      user.sub,
      'status',
      task.status,
      status
    )

    return c.json(updatedTask)
  })
})

// POST /api/tasks (Create Task)
const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  projectId: z.string().uuid(),
  assigneeId: z.string().uuid().optional(),
  clientVisible: z.boolean().default(false),
})

tasksApp.post('/', zValidator('json', createTaskSchema), async (c) => {
  const body = c.req.valid('json')
  
  const newTask = await prisma.task.create({
    data: {
      ...body,
      status: TaskStatus.TODO
    }
  })
  return c.json(newTask, 201)
})

// PATCH /api/tasks/:id (Edit Task details)
const editTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  version: z.number().int()
})

tasksApp.patch('/:id', zValidator('json', editTaskSchema), async (c) => {
  const user = c.get('jwtPayload')
  
  if (user.role === Role.INTERNAL || user.role === Role.CLIENT) {
    return c.json({ error: 'You do not have permission to edit core task details.' }, 403)
  }

  const taskId = c.req.param('id')
  const body = c.req.valid('json')

  return await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId, deletedAt: null } })
    if (!task) return c.json({ error: 'Task not found' }, 404)
    if (task.version !== body.version) return c.json({ error: 'Conflict' }, 409)

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        title: body.title,
        description: body.description,
        version: { increment: 1 }
      }
    })
    
    // Log changes
    if (body.title && body.title !== task.title) await createAuditLog(tx, taskId, user.sub, 'title', task.title, body.title)
    if (body.description && body.description !== task.description) await createAuditLog(tx, taskId, user.sub, 'description', task.description, body.description)

    return c.json(updated)
  })
})

// DELETE /api/tasks/:id (Soft Delete)
tasksApp.delete('/:id', async (c) => {
  const taskId = c.req.param('id')
  
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return c.json({ error: 'Task not found' }, 404)

  const deleted = await prisma.task.update({
    where: { id: taskId },
    data: { deletedAt: new Date(), version: { increment: 1 } }
  })
  
  return c.json({ success: true })
})

// POST /api/tasks/:id/dependencies
const dependencySchema = z.object({
  prerequisiteId: z.string().uuid()
})

tasksApp.post('/:id/dependencies', zValidator('json', dependencySchema), async (c) => {
  const user = c.get('jwtPayload')
  if (user.role !== Role.PM) return c.json({ error: 'Only PMs can define dependencies' }, 403)
  
  const taskId = c.req.param('id')
  const { prerequisiteId } = c.req.valid('json')

  if (taskId === prerequisiteId) {
    return c.json({ error: 'A task cannot depend on itself.' }, 400)
  }

  try {
    const dependency = await prisma.taskDependency.create({
      data: {
        taskId,
        prerequisiteId
      }
    })
    
    // Check if the current task status needs to be BLOCKED (if prerequisite is not DONE)
    const prereqTask = await prisma.task.findUnique({ where: { id: prerequisiteId } })
    if (prereqTask && prereqTask.status !== TaskStatus.DONE) {
       await prisma.task.update({
         where: { id: taskId },
         data: { status: TaskStatus.BLOCKED, version: { increment: 1 } }
       })
    }

    return c.json(dependency, 201)
  } catch (error) {
    return c.json({ error: 'Dependency already exists or invalid task ID' }, 400)
  }
})

// GET /api/tasks/standup-summary
tasksApp.get('/standup-summary', async (c) => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 1. What was completed yesterday
  const completedLogs = await prisma.auditLog.findMany({
    where: {
      changedColumn: 'status',
      newValue: 'DONE',
      timestamp: {
        gte: yesterday,
        lt: today
      }
    },
    include: {
      user: true
    }
  })
  
  const taskIds = [...new Set(completedLogs.map(l => l.taskId))]
  const completedTasksData = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, title: true }
  })
  const tasksMap = Object.fromEntries(completedTasksData.map(t => [t.id, t.title]))

  // 2. What is blocked today
  const blockedTasks = await prisma.task.findMany({
    where: {
      status: 'BLOCKED',
      deletedAt: null
    },
    include: {
      assignee: true
    }
  })

  const summary: Record<string, any> = {
    completedYesterday: {},
    blockedToday: {}
  }

  // Group by department
  for (const log of completedLogs) {
    const dept = log.user.department || 'UNKNOWN'
    if (!summary.completedYesterday[dept]) summary.completedYesterday[dept] = []
    summary.completedYesterday[dept].push({
      taskId: log.taskId,
      taskTitle: tasksMap[log.taskId] || 'Unknown Task',
      completedBy: log.user.name
    })
  }

  for (const task of blockedTasks) {
    const dept = task.assignee?.department || 'UNKNOWN'
    if (!summary.blockedToday[dept]) summary.blockedToday[dept] = []
    summary.blockedToday[dept].push({
      taskId: task.id,
      taskTitle: task.title,
      assignee: task.assignee?.name || 'Unassigned'
    })
  }

  return c.json(summary)
})

export default tasksApp
