# Claude Cowork Training Deck

## Complete Beginner's Guide to Autonomous AI Task Execution

---

## Slide 1: The AI Overwhelm Problem

**You're not alone.**

- AI tools are releasing faster than anyone can keep up
- Most people use Claude as a simple chatbot replacement
- They're missing the biggest capability leap: **autonomous task execution**
- Cowork bridges the gap between "AI that talks" and "AI that works"

> If you're only chatting with Claude, you're using 10% of its power.

---

## Slide 2: What is Claude Cowork?

**Claude Cowork gives the AI "hands" to work inside your computer.**

| Normal Claude | Claude Cowork |
|---|---|
| The **brain** -- answers questions | The **hands** -- executes tasks |
| You type, it responds | You assign, it delivers |
| Chat-based interaction | Autonomous task completion |
| Limited to conversation | Works with your actual files |

**Key Difference:** Tell Cowork what you want, step away, come back to finished work.

---

## Slide 3: Core Capabilities

Cowork can:

1. **Access files directly** on your computer (with your permission)
2. **Sub-agent coordination** -- breaks complex work into smaller tasks handled by independent agents
3. **Produce professional outputs** -- Excel spreadsheets, documents, formulas, presentations
4. **Work on long-running tasks** -- complex multi-step workflows
5. **Browse the web** -- research, data collection, and analysis via Chrome

---

## Slide 4: Prerequisites

Before you start, you need:

- [ ] **Claude Pro account** ($17/month) -- required for Cowork features
- [ ] **Claude Desktop app** -- download from claude.ai/downloads (Mac or Windows)
- [ ] **Google Chrome** -- for web browsing capabilities (optional but recommended)
- [ ] **Claude in Chrome extension** -- from the Chrome Web Store (optional)

---

## Slide 5: Installation -- Step by Step

### Step 1: Download Claude Desktop

1. Log into Claude at claude.ai
2. Click the **Download** button in the bottom-left corner
3. Select your operating system (macOS or Windows)
4. Install the application

### Step 2: Log In

1. Open Claude Desktop
2. Sign in with your Pro account credentials
3. You'll see the familiar chat interface plus new options at the top

---

## Slide 6: The Cowork Interface

Once logged into Claude Desktop, you'll see three modes at the top:

| Mode | Purpose |
|---|---|
| **Chat** | Standard Claude conversation (same as web) |
| **Cowork** | Autonomous task execution (today's focus) |
| **Code** | Developer-focused coding environment (advanced) |

Additional features available in Desktop:
- Voice input functions
- Sidebar with projects and artifacts
- Full chat history

---

## Slide 7: The Golden Rule -- Folder Access & Security

**Cowork can only touch folders you explicitly allow.**

### Best Practices:

- **Create a dedicated folder** (e.g., `~/Cowork/`) for Cowork tasks
- **Be specific** -- give access only to the folder relevant to the current task
- **Cowork will ask permission** before accessing any folder
- **You confirm each time** -- "Allow Claude to change files in [folder name]"

### Security Model:

```
Your Computer
  |-- Documents/        (locked -- Cowork can't touch)
  |-- Desktop/          (locked -- Cowork can't touch)
  |-- Cowork/           (unlocked -- you gave permission)
       |-- Project A/   (accessible)
       |-- Project B/   (accessible)
```

> Always use the narrowest folder scope possible for each task.

---

## Slide 8: Model Selection

Before running a task, choose your model in the right-hand panel:

| Model | Best For | Token Usage |
|---|---|---|
| **Sonnet 4.5** | Everyday tasks, file organization, basic documents | Standard |
| **Opus 4.6** | Complex reasoning, multi-step analysis, high-quality output | Higher |

**Options:**
- Toggle **Extended Thinking** on/off for deeper reasoning
- Heavier tasks consume more of your usage allowance
- Allowance resets every few hours

> Start with Sonnet 4.5 for most tasks. Use Opus for complex work.

---

## Slide 9: Your First Task -- File Organization

### Scenario: Organize a messy screenshots folder

**The Prompt:**

```
Go through my screenshots, rename them so it's obvious what they are,
and then place them in a folder structure that makes them easier for
me to find in the future.
```

**What Happens:**

1. Cowork scans and catalogs all files
2. Analyzes content of each screenshot
3. Creates a logical folder structure (e.g., Sports/, Travel/, Work/)
4. Renames files with descriptive names
5. Moves everything into the right folders

**Result:** Completed in under 4 minutes. Hundreds of files organized.

---

## Slide 10: What File Organization Looks Like

### Before:

```
Screenshots/
  |-- IMG_4521.png
  |-- Screenshot 2024-03-15.png
  |-- IMG_4522.png
  |-- photo_2024_01_09.png
  |-- ... (hundreds more)
```

### After:

```
Screenshots/
  |-- Sports/
  |    |-- England-Cricket-Match-Details.png
  |    |-- Premier-League-Scores-Jan-2024.png
  |-- Travel/
  |    |-- Boarding-Pass-London-NYC-Mar-2024.png
  |    |-- Hotel-Confirmation-Paris.png
  |-- Work/
  |    |-- Q1-Revenue-Dashboard.png
  |    |-- Team-Meeting-Notes-Whiteboard.png
```

> Think how long this would take manually. Cowork does it in minutes.

---

## Slide 11: Task 2 -- Creating Files from Messy Data

### Scenario: Invoice processing and reconciliation

**Setup:**
1. Give Cowork access to your invoice folder
2. The folder contains 6-7 disorganized invoice PDFs

**The Prompt:**

```
Go through these invoice files. Rename them properly, organize them
into folders, and generate a spreadsheet/CSV giving me a clean
overview of all invoices.
```

---

## Slide 12: Interactive Clarification

**Cowork asks smart questions before executing:**

| Question | Your Answer |
|---|---|
| What naming format for invoices? | Date - Vendor Name - Amount |
| What should the spreadsheet include? | Everything -- complete overview with auto-calculated totals |
| How to organize monthly folders? | By invoice date |

**This is like having a personal assistant:**
- Here's the task
- They ask clarifying questions
- You give answers
- They deliver the finished work

---

## Slide 13: Invoice Processing Results

**Completed in under 5 minutes:**

### Organized Folder Structure:

```
Invoice-Processor/
  |-- 2024-01/
  |    |-- 2024-01-15-Acme-Corp-$2,500.pdf
  |    |-- 2024-01-22-CloudHost-$189.pdf
  |-- 2024-02/
  |    |-- 2024-02-01-Design-Agency-$4,200.pdf
  |-- All-Invoices/
  |    |-- (all originals, renamed)
  |-- invoice-tracker.csv
```

### Generated Spreadsheet Contains:

- Vendor names
- Invoice numbers
- Invoice dates
- Payment status
- Amounts
- Monthly breakdowns
- Auto-calculated totals

> You can keep this file updated by running the process again with new invoices.

---

## Slide 14: Web Browsing -- Setup

### Enabling Chrome Integration:

1. **Install the "Claude in Chrome" extension** from the Chrome Web Store
2. Open Cowork and assign a web-based task
3. When prompted, allow Claude to browse specific websites
4. Active tabs show an **orange highlight** when Claude is using them

### Permission Levels:

| Option | What It Means |
|---|---|
| Allow for this time | One-time access |
| Allow for this website | Persistent access to that site |
| Allow all | Full browsing access (use cautiously) |

---

## Slide 15: Web Browsing in Action

### Scenario: YouTube channel performance report

**The Prompt:**

```
Use Chrome to go to my YouTube Studio. Write a report on the
current performance of my YouTube channel.
```

**What Happens:**

1. Cowork opens Google Chrome
2. Navigates to YouTube Studio
3. Reads dashboard data, analytics, and metrics
4. Compiles findings into a professional report
5. Delivers the report as a document

**Real-World Applications:**
- SEO reporting from Google Search Console
- Analytics reports from Google Analytics
- Competitive research across multiple websites
- Social media performance audits

---

## Slide 16: Connectors -- Extending Cowork's Reach

Access the connectors menu via the **+** button in the bottom-left of the chat window.

### Available Connectors:

| Connector | Use Case |
|---|---|
| **Gmail** | Email management, drafting, searching |
| **Google Drive** | Document access, editing, organization |
| **Notion** | Knowledge base access, page creation |
| **Excalidraw** | Visual diagrams and whiteboarding |

**Connectors use API/MCP access** -- they connect directly to apps rather than browsing the web, making them faster and more reliable.

---

## Slide 17: Plugins & Skills

### What Are Skills?

Skills are pre-built processes, expertise, and workflows that enhance Cowork's capabilities.

### Built-in Skills from Anthropic:

| Skill | Purpose |
|---|---|
| **Sales** | Call prep, pipeline management, personalized messaging |
| **Productivity** | Task management, workflow optimization |
| **Marketing** | Campaign planning, content strategy |

### Adding Custom Skills:

1. Click the **+** button, then **Add Plugins**
2. Options:
   - Upload individual skill files
   - Add a GitHub marketplace URL (e.g., "Awesome Claude Skills" repo)
3. Install skills from the marketplace (100+ available)
4. Manage installed skills from the plugins panel

---

## Slide 18: Projects Integration

### Using Claude Projects in Cowork:

1. Click the **+** button
2. Select **Include Project**
3. Choose from your existing Claude Projects (custom knowledge bases)
4. Cowork downloads and saves project files locally for use

### Power Combo Example:

```
YouTube Studio Report (web browsing)
  + Notion Ideas Database (connector)
  + Content Marketing Skill (plugin)
  = Automated content calendar with data-backed topic selection
```

> Start with basics. Layer on complexity as you get comfortable.

---

## Slide 19: Best Starting Use Cases

| Category | Example Tasks |
|---|---|
| **File & Document Management** | Organize downloads, rename photos, sort documents, clean up folders |
| **Research & Analysis** | Web research reports, competitor analysis, data gathering |
| **Document Creation** | Spreadsheets from raw data, formatted reports, CSV exports |
| **Data & Analysis** | Invoice reconciliation, expense tracking, performance dashboards |

### For Business Owners:

- Monthly financial reconciliation
- Client file organization
- Marketing performance reports
- Content calendar generation
- Email template creation

---

## Slide 20: Current Limitations

Be aware of these constraints (Cowork is still a Research Preview):

| Limitation | Detail |
|---|---|
| **No cross-session memory** | Cowork doesn't remember previous sessions. Workaround: maintain a file/folder structure documenting your ongoing work. |
| **No chat sharing** | Can't easily share Cowork chats with other users |
| **Desktop only** | Requires the Claude Desktop app (not available on mobile/web) |
| **Session persistence required** | Desktop app must stay open for tasks to continue. Closing the app stops the task. |
| **Uses computer resources** | Tasks consume local compute power while running |
| **Token consumption** | Heavier tasks burn through your usage allowance faster |

---

## Slide 21: Tips for Effective Prompting

### Do:

- Give **clear instructions and goals**
- Be **specific** about desired output format
- Let Cowork **ask clarifying questions** -- answer them
- Use **dedicated folders** per task type
- Start **simple**, then layer on complexity

### Don't:

- Don't over-engineer prompts -- plain English works
- Don't give access to your entire filesystem
- Don't run heavy tasks if you need your token allowance for other work
- Don't close the Desktop app mid-task

---

## Slide 22: Quick-Start Checklist

- [ ] Sign up for Claude Pro ($17/month)
- [ ] Download Claude Desktop from claude.ai/downloads
- [ ] Create a dedicated Cowork folder on your computer
- [ ] Run your first file organization task
- [ ] Try creating a spreadsheet from unstructured data
- [ ] Install the Claude in Chrome extension
- [ ] Run a web research task
- [ ] Explore connectors (Gmail, Google Drive, Notion)
- [ ] Browse the skills marketplace and install one
- [ ] Combine multiple capabilities in a single workflow

---

## Slide 23: Summary

| What You Learned | Key Takeaway |
|---|---|
| What Cowork is | AI with "hands" -- autonomous task execution on your computer |
| How to set it up | Desktop app + folder access + optional Chrome extension |
| File organization | Point it at a folder, describe what you want, let it work |
| File creation | It can generate spreadsheets, documents, and reports from raw data |
| Web browsing | Chrome extension enables research and data collection |
| Connectors & plugins | Extend capabilities with Gmail, Notion, skills marketplace |
| Limitations | No memory, desktop-only, session must stay open |

**Start simple. Build confidence. Layer on complexity.**

Cowork is in Research Preview -- this is the worst version you'll ever use, and it's already transforming workflows.
