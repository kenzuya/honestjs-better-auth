# Honest Better Auth Example

A small notes API showing [`@kenzuya/honest-better-auth`](../../README.md) on [Honest](https://github.com/kenzuya/honest).

## Features Demonstrated

- **BetterAuthPlugin** mounting Better Auth on `/api/auth`
- **AuthGuard** registered as a global guard
- **@AllowAnonymous()** - public route
- **@OptionalAuth()** - personalized response when signed in
- **@Session()** - the signed-in user's session in protected routes
- **@Hook()** - a service that runs after sign-up
- **In-memory database** - no setup required, data resets on restart

## Setup

```bash
cp .env.example .env
bun install
bun dev
```

## API Endpoints

| Method | Path                      | Access                  |
| ------ | ------------------------- | ----------------------- |
| GET    | `/notes/public`           | Public                  |
| GET    | `/notes/greeting`         | Optional auth           |
| GET    | `/notes`                  | Signed in               |
| POST   | `/notes`                  | Signed in               |
| POST   | `/api/auth/sign-up/email` | Better Auth             |
| POST   | `/api/auth/sign-in/email` | Better Auth             |
| GET    | `/api/auth/get-session`   | Better Auth             |

## Trying It

```bash
# Sign up and save the session cookie
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123", "name": "Test User"}' \
  -c cookies.txt

# Protected routes return 401 without a session
curl -i http://localhost:3000/notes

# Create and list notes with the cookie
curl -X POST http://localhost:3000/notes -b cookies.txt \
  -H "Content-Type: application/json" -d '{"text": "Hello Honest"}'
curl http://localhost:3000/notes -b cookies.txt
```
