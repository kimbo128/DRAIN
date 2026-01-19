# Contributing to DRAIN

Thank you for your interest in contributing to DRAIN.

## Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run tests (`forge test` for contracts, `pnpm test` for SDK)
5. Commit with clear messages
6. Open a Pull Request

## Development Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) for smart contracts
- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/) for TypeScript packages

### Contracts

```bash
cd contracts
forge install
forge build
forge test
```

### SDK

```bash
cd sdk
pnpm install
pnpm build
pnpm test
```

## Areas of Contribution

### Smart Contracts
- Core payment channel logic
- Gas optimizations
- Security hardening
- Test coverage

### SDK
- Wallet integrations
- Streaming handlers
- Developer experience

### Documentation
- Protocol specification
- Integration guides
- API documentation

### Research
- Payment channel improvements
- Cross-chain considerations
- Economic analysis

## Code Standards

- **Solidity**: Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- **TypeScript**: ESLint + Prettier configuration included
- **Commits**: Clear, descriptive commit messages
- **Tests**: All new functionality must include tests

## Pull Request Process

1. Ensure all tests pass
2. Update documentation if needed
3. Request review from maintainers
4. Address feedback
5. Squash commits before merge

## Communication

- **Issues**: Bug reports; feature requests
- **Discussions**: Design questions, protocol ideas
- **Pull Requests**: Code contributions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
