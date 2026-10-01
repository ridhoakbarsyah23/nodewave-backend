import { describe, it, expect } from 'bun:test'
import authApp from '../src/auth'

describe('Auth Service', () => {
  it('should have a login route', () => {
    const routes = authApp.routes.map(r => r.path)
    expect(routes).toContain('/login')
  })

  it('should have a register route', () => {
    const routes = authApp.routes.map(r => r.path)
    expect(routes).toContain('/register')
  })

  it('should have a logout route', () => {
    const routes = authApp.routes.map(r => r.path)
    expect(routes).toContain('/logout')
  })
})
