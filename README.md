# Fail Forward Gallery

> A student-led platform for sharing failure stories and building resilience among university students.

**🏆 NUS-funded Project — S$5,000**  
**🌏 Five-country International Team**  
**🎓 NUS Asian Undergraduate Symposium (AUS) 2026**

**Project Lead & Presenter:** Shuyue Quan / 全书阅

Developed through a five-country international team during NUS AUS 2026, with English used as the primary language for project discussion, coordination, and presentation.

University students are constantly exposed to stories of success, while failure is often hidden. Fail Forward Gallery creates a safer space for students to share setbacks, learn from others, and access practical support.

> **Current status:** active six-month implementation following the AUS-funded concept stage. The repository contains a working bilingual product, a local account and moderation foundation, and the documentation that guides the next production stages.

## About

Fail Forward Gallery is an anonymous storytelling and peer-support platform designed first for university students in China. It gives students a place to talk about academic setbacks, job-search rejection, financial pressure, loneliness, and difficulty fitting in without attaching those experiences to a public identity.

The project combines a searchable story archive with choice-based responses, practical resources, and author follow-ups. It is a peer-support and educational project, not a clinical service, and it does not promise that every story must end in success or recovery.

## Background

Achievement is highly visible on campus and online; disappointment is usually private. Students can therefore experience a common setback as evidence that they alone are falling behind.

Fail Forward Gallery was created to challenge that imbalance. Instead of treating failure as a personal defect, the platform makes room for honest, unfinished stories and connects emotional validation with context-specific support. Its China-first design reflects the pressures surrounding examinations, postgraduate admissions, recruitment, family expectations, the urban–rural divide, and studying away from home.

## Recognition

- Selected for the **NUS Asian Undergraduate Symposium (AUS) 2026**.
- Awarded **S$5,000 in project funding by the National University of Singapore**.
- Developed by an **international undergraduate team spanning five countries**.
- Supported by a **six-month implementation period** to move from concept to a safer, testable product.
- Designed as an open and adaptable model that can later support collaboration across universities in Asia.

## What We Built

| Product area | What it enables | Current state |
| --- | --- | --- |
| Failure Story Archive | Browse anonymous stories by thematic board, tag, response preference, and search | Working |
| Choice-based Comments | Authors choose encouragement, similar experiences, gentle advice, or no comments | Working prototype |
| Advice Hub | Open card-based, context-specific guidance linked to common student setbacks | Working |
| Follow-up System | Original anonymous authors can add an update without being pressured to present a positive outcome | Working prototype |
| Bilingual Experience | Chinese-first interface with an English option | Working |
| Account & Story Ownership | Private mobile-based account foundation separates ownership from public anonymity | Local V0.2 service |
| Human Review Workflow | New stories remain private until an authorised reviewer approves them; decisions include reasons and audit events | Local V0.2 service |
| AI-assisted Safety Screening | Risk classification before human review | Planned; no production AI service connected |
| Ranking & Discovery | View-, response-, and editor-informed discovery with anti-abuse safeguards | Planned |
| Pop-up Exhibition | Physical story gallery and facilitated reflection activities | Planned pilot component |

### A deliberately honest product boundary

The public-facing experience and local V0.2 service are real working software, but this repository is **not yet a production mental-health platform**. Real SMS delivery, production cloud storage, AI safety screening, review-notification email, regional crisis-resource operations, and shared public deployment still require implementation and operational review.

## My Role

**Project Lead & Presenter**

- Led the development of the problem framing, product concept, and implementation roadmap.
- Coordinated an international team across five countries, using English for project discussion, collaboration, and presentation.
- Conducted and synthesised student interviews to connect lived experiences with product decisions.
- Managed product iteration from the symposium concept through the funded implementation stage.
- Presented the project in English at NUS AUS 2026.
- Led post-AUS implementation, including the transition from a static prototype toward accounts, content ownership, and accountable human moderation.
- Maintained the product’s focus on anonymity, user control, psychological safety, and culturally grounded design.

## User Research

We conducted interviews with university students to understand how they experience academic failure, social isolation, recruitment pressure, and the expectation to present success online. We do not publish raw interviews or identifying details in this repository.

The research is used as a product input rather than decoration:

| Research insight | Product decision |
| --- | --- |
| Students often hide setbacks because they expect judgment or do not want a difficult moment attached to their identity. | Public posts and responses are anonymous, while private account ownership enables follow-ups, withdrawal, and review status. |
| Not everyone wants advice when sharing something vulnerable. | Authors choose their preferred response mode, including a no-comments option. |
| Generic encouragement can feel disconnected from academic, financial, family, or cultural realities. | Stories, tags, and Advice Hub content are organised around specific contexts and lived categories. |
| A setback does not always resolve neatly or positively. | Follow-ups allow “still difficult,” “no major change,” small steps, improvement, or a preference not to disclose. |
| Students wanted easier ways to find relevant experiences without flattening them into a single narrative. | Board filters, shared tag data, search, and planned responsible ranking improve discovery while preserving context. |

These findings continue to shape tag design, discovery mechanisms, interface refinement, moderation rules, and the kinds of stories and support the platform makes room for.

## Product Experience

The current product includes a Chinese-first home experience, a filterable anonymous archive, story details and follow-ups, a card-based Advice Hub, a guided submission flow, private “My Stories” ownership, and an authorised human-review queue.

> Product screenshots are being captured from the current working build and will be added here without publishing test phone numbers, private submissions, or interview material.

## Design Principles

### Anonymous in public, accountable in private

Readers never see a phone number, email address, internal account identifier, or cross-story public profile. Private account ownership exists only so an author can recognise and manage their own contributions.

### Safe by design

New server-backed submissions stay private until a human reviewer approves them. The product separates automated risk signals from the authority to publish: AI may eventually reject clear violations or route ambiguity to review, but only a human reviewer can approve public content.

### Non-judgmental support

The interface avoids recovery scores, success rankings, streaks, and forced positive conclusions. “No change” is treated as a valid follow-up.

### User control

Authors choose tags, response boundaries, follow-up visibility, and—within the planned production workflow—withdrawal and appeal options.

### Universal resonance, contextual specificity

The emotional experience of failure can cross borders, but its causes and consequences differ. Boards, tags, advice, and moderation preserve the context of each story rather than reducing it to generic motivation.

## Current Status

The project is in active V0.2 implementation.

### Available in the browser experience

- Chinese-first interface with English switching.
- Story Archive with board, tag, response-mode, and text filters.
- Shared tag taxonomy across filtering and story submission.
- Anonymous story detail, comments, no-comment boundaries, and a Day 30 follow-up example.
- Guided 150–200 unit story submission with English-word and CJK-character counting.
- Advice Hub, accessibility foundations, mobile layouts, and demo reset controls.

### Available in the local V0.2 service

- Mainland China mobile-number verification flow with development-only terminal codes.
- Private HttpOnly sessions and pseudonymised phone storage.
- Server-backed story submission and private “My Stories” status.
- Role-protected human-review queue, approve/reject reasons, and immutable audit events.
- Public API access only to human-approved anonymous stories.

### Next implementation priorities

1. Production SMS provider and regional PostgreSQL deployment.
2. Server-backed comments and follow-ups using the same ownership and review model.
3. Compliant AI-assisted risk classification with human-only publication approval.
4. Notifications, appeals, withdrawal, reporting, and moderator wellbeing procedures.
5. Responsible ranking and discovery with rate limiting and anti-manipulation safeguards.
6. Pilot evaluation, pop-up exhibition materials, and a reusable implementation toolkit.

Detailed product and architecture decisions are documented in [V0.1](./docs/v0.1/) and [V0.2](./docs/v0.2/).

## Tech Stack

The stack is intentionally small so the team can inspect and improve the full product:

- **Frontend:** semantic HTML, CSS, and vanilla JavaScript
- **Local service:** Node.js
- **Development data:** SQLite
- **Product structure:** bilingual interface, shared tag model, modular authentication and moderation adapters
- **Testing:** Node.js syntax checks and built-in test runner

No React, Vue, frontend build tool, or third-party UI framework is required.

<details>
<summary><strong>Run the current build locally</strong></summary>

Node.js 24 or later is required for the complete V0.2 flow.

~~~bash
npm start
~~~

Open <code>http://127.0.0.1:4173</code>.

For local moderation testing only, start the service with a non-personal development reviewer number:

~~~bash
FFG_DEV_MODERATOR_PHONE=13900139000 npm start
~~~

Development verification codes appear only in the server terminal. They are not sent as real SMS messages and must never be used as evidence of a production messaging system.

Run the automated checks with:

~~~bash
npm run check
npm test
~~~

</details>

## Privacy and Safety Notes

- Do not put real names, student IDs, contact details, interview transcripts, or identifiable research material into sample stories.
- <code>.env</code>, local secrets, SQLite files, and logs are excluded from Git.
- This project provides peer support and education; it is not a substitute for clinical care or emergency services.
- Production launch requires verified region-appropriate crisis resources and a documented escalation process.

## Project Lead

**Shuyue Quan / 全书阅**  
Project Lead & Presenter, Fail Forward Gallery  
NUS Asian Undergraduate Symposium 2026

---

*Failure is not a fixed ending. Stories can continue, change, or remain unresolved.*
