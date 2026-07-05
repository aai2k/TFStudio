<!--
Thanks for contributing to TFStudio! Please read CONTRIBUTING.md first.
Keep PRs focused and self-contained.
-->

## Summary

<!-- What does this PR change, and why? -->

## Related issue

<!-- e.g. Closes #123. Open an issue first for large or physics-affecting changes. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Optical engine / optimizer / numerical change
- [ ] Documentation
- [ ] Refactor / tooling (no behavior change)

## Scientific validation

<!--
Required if this changes any computed result (engine, optimizer, material model,
analysis). Delete this section only for pure UI/docs/tooling changes.
-->

- **Method / source:** <!-- author, paper/book, equation & page -->
- **Reference compared against:** <!-- OptiLayer / TFCalc / published result / analytic check -->
- **Agreement:** <!-- e.g. matches to < 10 ppm over 400–700 nm -->

## Checklist

- [ ] `npm test` passes locally
- [ ] Added/updated tests for the change (required for numerical changes)
- [ ] Cited the literature source for any new/changed physics (in code + above)
- [ ] User-facing strings go through the localization system (English added)
- [ ] No build output, logs, `node_modules`, or personal config committed
- [ ] Change is focused (no unrelated refactors)
