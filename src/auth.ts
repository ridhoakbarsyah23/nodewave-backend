import { Hono } from 'hono'
import { PrismaClient } from '@prisma/client'
import { sign } from 'hono/jwt'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const prisma = new PrismaClient()
const authApp = new Hono()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

authApp.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const isMatch = await Bun.password.verify(password, user.password)
  if (!isMatch) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const payload = {
    sub: user.id,
    role: user.role,
    department: user.department,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 1 day
  }

  const token = await sign(payload, process.env.JWT_SECRET || 'supersecretjwtkey')

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
    }
  })
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(['PM', 'INTERNAL', 'CLIENT']),
  department: z.enum(['UI_UX', 'FRONTEND', 'BACKEND']).optional(),
})

authApp.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, name, role, department } = c.req.valid('json')

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return c.json({ error: 'Email already in use' }, 400)
  }

  const passwordHash = await Bun.password.hash(password)

  const user = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      name,
      role: role as any,
      department: department as any,
    }
  })

  return c.json({
    message: 'User registered successfully',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
    }
  }, 201)
})

authApp.post('/logout', async (c) => {
  return c.json({ message: 'Logged out successfully' })
})

export default authApp
