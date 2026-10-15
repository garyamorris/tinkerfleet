# Tiny project

This project deliberately subtracts when it should add. It has no dependencies.

```sh
node --test sum.test.js
```

Two tests should fail initially. Ask Tinkerfleet to read `sum.js`, propose the
smallest repair, and check it with `node --test sum.test.js`.

Demo mode simulates the story without changing files. In live mode with local
tools enabled, approving the edit changes this real source file. An approved
command runs here with your user permissions. The working folder is not an OS
sandbox, so use trusted practice code and read the approval before proceeding.
