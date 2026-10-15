# Tiny project

This project deliberately subtracts when it should add. It has no dependencies.

```sh
npm test
```

Two tests should fail initially. Ask Tinkerfleet to read `sum.js`, propose the
smallest repair, and check it with `node --test`. In Demo mode the story and output
are simulated. In Live mode an approved edit changes the run's in-memory snapshot;
an approved command tests a copy of that snapshot in Docker. Neither mode writes
the repair back to this source directory. Review and apply the change yourself
if you want to fix this example permanently.
