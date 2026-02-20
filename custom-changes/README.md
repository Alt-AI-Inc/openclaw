# Custom Changes Documentation

This directory contains documentation for custom modifications and enhancements made to OpenClaw for specific deployment scenarios.

## Purpose

While OpenClaw is designed to be flexible and extensible, some deployments require specific customizations. This directory documents:

1. **What** was changed and why
2. **How** the changes work technically
3. **Configuration** required for deployment
4. **Testing** procedures and considerations
5. **Key learnings** and architectural insights

## Documents

### [session-isolation-with-trusted-proxy.md](./session-isolation-with-trusted-proxy.md)

Implementation of per-user session isolation for multi-user gateway deployments using trusted-proxy authentication (e.g., behind Cloudflare Workers).

## Contributing

When making custom modifications:

1. Create a new markdown file in this directory
2. Use the session isolation doc as a template
3. Include: problem, solution, implementation details, configuration, testing, and learnings
4. Commit the documentation with your code changes

This helps with:

- Understanding why changes were made
- Maintaining changes during upgrades
- Sharing knowledge with the team
- Debugging issues in production
