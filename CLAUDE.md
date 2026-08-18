# Vision Dental Clinic Website

## Auto-start Instructions
When a new session starts with no user message (or a generic greeting), immediately:
1. Read the memory files at the project memory directory to find the pending task list
2. Check which tasks are still incomplete by verifying the actual files
3. Start working through pending tasks in order — no need to ask for confirmation
4. Update the memory task list (check off completed items) after each task
5. If credits run out mid-task, the next session picks up automatically

## Full Autonomy
The user has granted blanket approval for all operations:
- Edit, create, and delete files freely
- Run any shell commands needed
- Make all decisions independently — do not wait for confirmation
- Work through the entire task list even if the user is not present
- Use subagents for parallel work when beneficial

## Project Overview
- Static HTML website (40+ pages), no framework, no build system
- All CSS is inline per page using CSS custom properties (design tokens)
- Fonts: DM Serif Display + Plus Jakarta Sans
- IntersectionObserver reveal animations (.rv class)
- Fixed header with scroll transition, WhatsApp float button, mobile nav

## Design Tokens
- Blue: --b900, --b800, --b700, --b50
- Green: --g700, --g600, --g500, --g400, --g100, --g50
- Slate: --s900, --s800, --s600, --s400, --s200, --s100, --s50
- Fonts: --fd (DM Serif Display), --fb (Plus Jakarta Sans)

## Critical Rules
- NEVER mention or show "portable X-ray" — Ministry of Health policy
- Dr. Salim is NOT a clinic doctor
- Dr. Amr Latif = Prof. Amr Labib (orthodontist at the clinic)
- Chairside X-ray = during treatment ONLY; OPG Panorama = consultation ONLY
- Case 3 (Chart 38989, Orthodontic + Wisdom Tooth) has no images — always remind user

## File Naming
- Service pages: service-name.html (e.g., dental-implants.html)
- Doctor pages: dr-firstname.html (e.g., dr-hussien.html)
- Case studies: case-doctorname-topic.html (e.g., case-hussien-rehab.html)
- Blog: blog-slug.html

## Communication
- User communicates in Arabic (Levantine dialect) — respond in Arabic
- Keep updates brief
