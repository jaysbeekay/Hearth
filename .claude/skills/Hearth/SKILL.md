```markdown
# Hearth Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the Hearth codebase, a TypeScript project built with the Next.js framework. You'll learn how to structure files, write imports and exports, and follow commit message practices. Testing patterns and suggested commands for common workflows are also included.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `apiRoutes.ts`

### Import Style
- Use **alias imports** for modules.
  - Example:
    ```typescript
    import { getUser } from '@/services/userService'
    ```

### Export Style
- Use **named exports**.
  - Example:
    ```typescript
    // In userService.ts
    export function getUser(id: string) { ... }
    export function updateUser(user: User) { ... }
    ```

### Commit Messages
- Commit messages are **freeform** with no strict type or prefix.
- Average length is about 35 characters.
  - Example:  
    ```
    Add user profile endpoint
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new feature or component  
**Command:** `/add-feature`

1. Create a new file using camelCase naming.
2. Write your component or function using TypeScript.
3. Use alias imports for dependencies.
4. Export your functions or components using named exports.
5. Add or update tests in a corresponding `.test.ts` file.
6. Commit your changes with a clear, concise message.

### Refactoring Code
**Trigger:** When improving or restructuring existing code  
**Command:** `/refactor`

1. Identify files to refactor (ensure camelCase naming).
2. Update import statements to use aliases if not already.
3. Refactor exports to use named exports.
4. Update related tests as needed.
5. Commit with a message describing the refactor.

### Writing Tests
**Trigger:** When adding or updating tests  
**Command:** `/write-test`

1. Create or update a test file with the pattern `*.test.ts`.
2. Write tests for your functions or components.
3. Run the test suite (framework unknown; use your standard test runner).
4. Commit your test changes.

## Testing Patterns

- Test files use the pattern: `*.test.*` (e.g., `userService.test.ts`)
- The testing framework is not specified; follow project or team standards.
- Example test file:
  ```typescript
  // userService.test.ts
  import { getUser } from '@/services/userService'

  test('getUser returns user data', () => {
    const user = getUser('123')
    expect(user).toBeDefined()
  })
  ```

## Commands
| Command        | Purpose                                 |
|----------------|-----------------------------------------|
| /add-feature   | Start workflow for adding a new feature |
| /refactor      | Begin code refactoring workflow         |
| /write-test    | Start writing or updating tests         |
```
