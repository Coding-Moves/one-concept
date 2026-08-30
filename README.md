# One Concept

**Learn one new concept every day.**

> One day. One concept. One small step forward.

One Concept sends you a single, carefully chosen technical concept each day —
AI, software engineering, computer science, mathematics, Linux — written in
two or three plain sentences with one concrete example. Read it in thirty
seconds, mark it learned, keep your streak alive.

## Install (Android)

Current build: **v1.1.1**

**[Download the APK](https://expo.dev/artifacts/eas/dMX7ZhXJSP1dxP3nSucftZdAsQZaU0ONGLvFQpFChHI.apk)** —
open on your phone, install, sign in, allow notifications. Updates arrive
over the air; this link changes only when a new native build ships.

## Features

- **One concept a day** — never repeated, drawn from the topics you follow
- **Human-sounding lessons** — short, plain, concrete; validated before publishing
- **Reminders that stop** — up to three a day, in your timezone, silent once you've learned
- **Streaks and history** — your personal knowledge record, synced across devices
- **Self-running** — content generates nightly; the app updates itself on every merge

## Core Idea: No Repeated Learning

Randomness is useful, but simple random selection is not enough.

The application should avoid repeatedly giving the same concept to the same user.

Instead of choosing randomly from every available concept, the system keeps track of the user's learning history.

```text
All available concepts
        |
        v
Remove concepts already learned
        |
        v
Select from remaining concepts
        |
        v
Generate today's lesson
        |
        v
Save it to learning history
```

This means every user can gradually build their own unique learning journey.

## Daily Notifications

The app is designed around a simple reminder system.

A user can receive up to three reminders during the day.

For example:

```text
08:00 — Your daily concept is ready
14:00 — Don't forget today's concept
20:00 — Your daily learning is waiting
```

Once the user opens and completes the day's lesson, unnecessary reminders should stop for that day.

Notification times should eventually be configurable according to the user's schedule and timezone.

## Learning Streak

Consistency is one of the main goals of One Concept.

After completing a daily lesson, the user's streak increases.

Example:

```text
Day 1   ✓
Day 2   ✓
Day 3   ✓
Day 4   ✓
Day 5   ✓

🔥 5 day streak
```

The streak is not meant to turn learning into a competition. It is simply a small reminder that consistent effort matters.

## Learning History

Every completed concept becomes part of the user's personal learning history.

A user should eventually be able to see:

* What they learned
* When they learned it
* Which category it belongs to
* Their current streak
* Their longest streak
* Total concepts learned
* Learning progress over time

This transforms the app from a notification tool into a personal knowledge record.

## AI-Powered Learning

AI is used to help create useful daily learning material.

A lesson should be:

* Short enough to read quickly
* Clear enough to understand
* Technically meaningful
* Appropriate for the selected difficulty
* Different from previous lessons
* Focused on one concept

The goal is not to generate random motivational quotes.

The goal is to introduce **real knowledge**.

For example:

> **Concept: Idempotency**

> An operation is idempotent when performing it multiple times produces the same final result as performing it once. This is especially important when designing reliable APIs and distributed systems.

The concept can then include examples or deeper explanations as the application develops.

## Privacy & API Security

LLM API keys should never be stored directly inside the mobile application.

The intended architecture is:

```text
Mobile App
    |
    v
Backend API
    |
    v
LLM Provider
```

The backend is responsible for securely communicating with the AI provider.

User learning history and application data should also be handled through the backend/database layer rather than exposing sensitive credentials to the client.

## Planned Technology

The exact technology stack may evolve during development, but the initial direction is:

### Mobile

* React Native
* Expo
* TypeScript

### Backend

* Python
* FastAPI

### Database

* Firebase / Firestore or another suitable backend database

### Notifications

* Firebase Cloud Messaging
* Expo notification infrastructure where appropriate

### AI

* LLM API such as Gemini or another supported provider

### Development

* Git
* GitHub
* GitHub Actions
* Linux

## Project Structure

The project is expected to gradually evolve toward a structure similar to:

```text
one-concept/
├── mobile/
│   ├── app/
│   ├── components/
│   ├── services/
│   └── ...
│
├── backend/
│   ├── app/
│   ├── services/
│   ├── models/
│   └── ...
│
├── docs/
│
├── .github/
│   └── workflows/
│
├── FEATURES.md
├── README.md
└── LICENSE
```

The structure is intentionally kept flexible during the early stages.

## Development Philosophy

One Concept is being built with a few principles in mind:

### Keep it simple

The first version should solve the core problem before adding unnecessary features.

### Build for real use

The application should be useful to its developer and early users, not just serve as a demonstration project.

### Learn while building

The project is also intended to provide practical experience in:

* Mobile development
* Backend development
* APIs
* AI integration
* Databases
* Authentication
* Notifications
* Cloud deployment
* Testing
* CI/CD
* Software architecture

### Improve gradually

The project should grow through small, understandable changes rather than trying to build everything at once.

## Roadmap

The project will be developed incrementally.

### Phase 1 — Foundation

* [ ] Create mobile application
* [ ] Create initial UI
* [ ] Display a daily concept
* [ ] Add basic local state
* [ ] Establish project architecture

### Phase 2 — Daily Learning

* [ ] Generate concepts with AI
* [ ] Store concepts
* [ ] Prevent repeated concepts
* [ ] Add learning history
* [ ] Add completion tracking

### Phase 3 — Notifications

* [ ] Add push notifications
* [ ] Add multiple daily reminders
* [ ] Stop reminders after completion
* [ ] Add notification preferences
* [ ] Handle user timezone

### Phase 4 — Streaks

* [ ] Add daily streak
* [ ] Add longest streak
* [ ] Add total concepts learned
* [ ] Add progress statistics

### Phase 5 — Backend

* [ ] Build backend API
* [ ] Secure LLM credentials
* [ ] Add authentication
* [ ] Connect database
* [ ] Synchronize user data

### Phase 6 — Deployment

* [ ] Create production build
* [ ] Configure production environment
* [ ] Set up CI/CD
* [ ] Deploy backend
* [ ] Publish mobile application
* [ ] Configure over-the-air updates where appropriate

### Future

Possible future features include:

* [ ] Categories
* [ ] Difficulty levels
* [ ] Personalized learning
* [ ] Spaced repetition
* [ ] Quizzes
* [ ] Favorites
* [ ] Search
* [ ] Achievements
* [ ] Weekly summaries
* [ ] Monthly learning reports
* [ ] Multiple languages
* [ ] Offline reading
* [ ] Web application

## Contributing

Contributions, ideas, bug reports, and discussions are welcome.

Before making a large change, open an issue to discuss the idea and its direction.

For development guidelines, see `CONTRIBUTING.md` when available.

## License

This project is licensed under the terms specified in the repository's `LICENSE` file.

---

## The Goal

One Concept is built around a simple belief:

> **You don't need to learn everything today. You just need to learn something today.**

One concept at a time.

One day at a time.
