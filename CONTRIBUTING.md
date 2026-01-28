# Contributing to Temporal E-commerce

Thank you for your interest in contributing! This project demonstrates Temporal best practices and welcomes improvements.

## Ways to Contribute

1. **Report Bugs** - Found an issue? [Create an issue](../../issues)
2. **Suggest Features** - Have ideas for new workflow patterns? Share them!
3. **Improve Documentation** - Help others learn Temporal
4. **Add Tests** - More test coverage is always welcome
5. **Code Contributions** - Submit pull requests

## Development Setup

```bash
# Clone repository
git clone <repo-url>
cd temporal-ecommerce

# Install dependencies
pnpm install

# Start Temporal server
pnpm run docker:up

# Run tests
pnpm test
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `test:` for tests
6. Push to your fork
7. Open a pull request

## Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Write tests for new features

## Testing Guidelines

- Write unit tests for activities
- Write integration tests for workflows
- Test error scenarios and compensations
- Ensure tests are deterministic

## Questions?

Feel free to [open an issue](../../issues) or reach out!
