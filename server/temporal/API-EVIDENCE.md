# Temporal SDK evidence

Verified 18 November 2026 against official documentation. The worker is a separate, long-lived process; production builds can use `bundleWorkflowCode` and `workflowBundle.codePath`, and NativeConnection is the worker connection type. Worker health exposes actual SDK state, not a promise that this sandbox is always running. [1]

Signals acknowledge service acceptance, not handler completion. Updates return application results and synchronous validators cannot perform database I/O. Async handlers must finish before Continue-As-New. The implementation authenticates facts in MySQL first and deduplicates stable business event IDs, then records applied status in an Activity. [2]

The testing SDK provides a finite local test server and manually skipped time via `TestWorkflowEnvironment.sleep`, with mocked Activities and no production database connection. [3]

## References

[1]: https://docs.temporal.io/develop/typescript/workers/run-worker-process "Temporal production worker and workflow bundling"
[2]: https://docs.temporal.io/develop/typescript/workflows/message-passing "Temporal typed signals updates and async handlers"
[3]: https://docs.temporal.io/develop/typescript/best-practices/testing-suite "Temporal finite test environments and time skipping"
