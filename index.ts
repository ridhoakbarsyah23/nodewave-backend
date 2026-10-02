import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const app = new Hono()

app.use('*', cors())

app.get('/', (c) => {
  return c.json({ message: 'NodeWave Task Management API' })
})

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message, stack: err.stack }, 500)
})

import authApp from './src/auth'
import tasksApp from './src/tasks'

app.route('/api/auth', authApp)
app.route('/api/tasks', tasksApp)

const port = process.env.PORT ? parseInt(process.env.PORT) : 3005;
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port
})