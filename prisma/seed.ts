import { PrismaClient, Role, Department } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding data...')

  // Clear existing data (optional, useful for resetting)
  await prisma.auditLog.deleteMany()
  await prisma.taskDependency.deleteMany()
  await prisma.task.deleteMany()
  await prisma.project.deleteMany()
  await prisma.user.deleteMany()

  // We use Bun's built-in hashing
  const passwordHash = await Bun.password.hash('password123')

  // 1. Create PM Account
  const pm = await prisma.user.create({
    data: {
      email: 'pm@nodewave.com',
      password: passwordHash,
      name: 'Product Manager',
      role: Role.PM,
    }
  })

  // 2. Create Internal Team Accounts
  const uiux = await prisma.user.create({
    data: {
      email: 'uiux@nodewave.com',
      password: passwordHash,
      name: 'UI/UX Designer',
      role: Role.INTERNAL,
      department: Department.UI_UX,
    }
  })

  const frontend = await prisma.user.create({
    data: {
      email: 'frontend@nodewave.com',
      password: passwordHash,
      name: 'Frontend Engineer',
      role: Role.INTERNAL,
      department: Department.FRONTEND,
    }
  })

  const backend = await prisma.user.create({
    data: {
      email: 'backend@nodewave.com',
      password: passwordHash,
      name: 'Backend Engineer',
      role: Role.INTERNAL,
      department: Department.BACKEND,
    }
  })

  // 3. Create Client Guest Account
  const client = await prisma.user.create({
    data: {
      email: 'client@company.com',
      password: passwordHash,
      name: 'Client Guest',
      role: Role.CLIENT,
    }
  })

  // 4. Create a Sample Project
  const project = await prisma.project.create({
    data: {
      name: 'Nodewave E-Commerce Redesign',
      description: 'Revamping the core e-commerce platform.',
    }
  })

  // 5. Create Tasks with Dependencies
  const taskUI = await prisma.task.create({
    data: {
      title: 'Design Checkout Flow',
      description: 'Create Figma designs for the new checkout flow.',
      projectId: project.id,
      assigneeId: uiux.id,
      status: 'TODO',
      clientVisible: true
    }
  })

  const taskAPI = await prisma.task.create({
    data: {
      title: 'Checkout API Endpoints',
      description: 'Implement POST /checkout and integration with payment gateway.',
      projectId: project.id,
      assigneeId: backend.id,
      status: 'TODO',
      clientVisible: false
    }
  })

  const taskFrontend = await prisma.task.create({
    data: {
      title: 'Implement Checkout UI',
      description: 'Slice the Figma design and integrate with Checkout API.',
      projectId: project.id,
      assigneeId: frontend.id,
      status: 'BLOCKED',
      clientVisible: true
    }
  })

  // taskFrontend depends on taskUI and taskAPI
  await prisma.taskDependency.createMany({
    data: [
      { taskId: taskFrontend.id, prerequisiteId: taskUI.id },
      { taskId: taskFrontend.id, prerequisiteId: taskAPI.id }
    ]
  })

  console.log('Seeding completed successfully!')
  console.log('Test Accounts (Password: password123):')
  console.log('- pm@nodewave.com')
  console.log('- uiux@nodewave.com')
  console.log('- frontend@nodewave.com')
  console.log('- backend@nodewave.com')
  console.log('- client@company.com')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
