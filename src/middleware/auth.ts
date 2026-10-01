import { jwt } from 'hono/jwt'
import type { MiddlewareHandler } from 'hono'

export const authMiddleware: MiddlewareHandler = (c, next) => {
  const jwtMiddleware = jwt({
    secret: process.env.JWT_SECRET || 'supersecretjwtkey',
    alg: 'HS256',
  })
  return jwtMiddleware(c, next)
}
