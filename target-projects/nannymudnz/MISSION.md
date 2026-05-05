# Nanny Mud NZ — Mission

Nanny Mud NZ is a browser-based game built for New Zealand families. It uses Phaser and React
in an npm workspace, targeting mobile and desktop web browsers.

## Purpose

Deliver a polished, fun mud-themed game experience with clean code quality, fast feedback
loops, and supervised AI-assisted development via Factory.

## Factory scope

Factory manages issues on `shaunnez/nannymudnz` in supervised mode.  Agents may read,
write, and run shell commands in the local worktree.  All state transitions require human
approval before merge.

## Quality bar

- All tests pass (`npm test`)
- Lint clean (`npm run lint`)
- No TypeScript errors (`npm run typecheck`)
- Screenshot regression tests pass (`npm run test:screens`)
