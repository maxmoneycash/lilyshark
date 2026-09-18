# One board, three builds: give the board in your drawer a job

September 16, 2026 · One proposed experiment · No outreach, participation, payment or publication has occurred.

## The decision

Pitch **Seeed Studio’s XIAO team** a small, maker-funded series about the **base XIAO ESP32S3**: make a temperature cue, read light remotely, or bring fixed voice commands into Home Assistant. Invite viewers to choose a useful job for hardware they already own, then keep a credited parts reference for that job.

The hook is **“What job would you give this board?”** Each creator shows a board and its useful result, then points to the exact build. A viewer who makes an adaptation can show their own result beside the original, with both builders credited. The first test measures whether people choose a feasible project and act on its requirements, and whether the maker will fund the production. Additional sharing is a hypothesis, not a promised result.

**One board means one board model.** These are three separate projects with different accessories and firmware. The wireless display needs **two physical XIAOs**. Show that quantity before anyone chooses it. There is no promise that one bare board performs all three jobs simultaneously.

This proposal extends the [creator research’s small sponsored exhibition](../research/creator-marketing-2026-09-16.md) and preserves the [revenue plan’s paid production model](revenue-plan-2026-09-16.md). The existing $750 single-page offer remains unchanged. This is an internal proposal for a separately agreed three-page series, not a new public pricing tier.

## Why this first maker and board

Seeed publishes all three selected guides and explicitly lists the base ESP32S3 in their relevant sections. That gives the experiment a specific technical starting point and one supplier to ask about factual review, accessory availability and distribution. We already have a cleared base-board photo, but photographs of completed projects still require their own provenance or permission.

Seeed’s current [Creator & Affiliate Program](https://www.seeedstudio.com/blog/affiliate-program/) advertises project co-creation, samples, reposting support and a XIAO campaign. This establishes a relevant public business route. It does **not** establish a commission budget, guaranteed sample, approved code, repost or relationship with gadgets.sh. Approach the team through the official program’s contact route only after outreach is authorized; do not enroll or accept terms as part of research.

The commercial hypothesis is that useful project paths sell an ecosystem of boards and accessories while helping existing owners use their hardware. Seeed already has substantial documentation. We must prove that connecting the right project, revision and missing parts saves work; duplicating its wiki would be a weak paid deliverable.

## The three documented builds

Primary sources were inspected September 16, 2026. These are **source-supported candidate paths**, not builds reproduced by gadgets.sh. A participating builder must confirm the exact current configuration before a page is represented as their working build. Keep the base board distinct from Sense, Plus, C3 and C6 variants.

| Job and shareable result | Exact documented path | Prerequisites and release gate |
| --- | --- | --- |
| **Make it glow: a temperature cue.** A light’s color shows whether the room is above or below a chosen temperature. | **1× base XIAO ESP32S3**, LED Driver Board for XIAO, Grove DHT11 and addressable LEDs; Home Assistant and ESPHome. The maker supplies wiring and temperature-to-color configuration in [Temp-Color Sync LEDs](https://wiki.seeedstudio.com/led_driver_board/#temp-color-sync-leds). | Also needs suitable power, wiring, USB programming access, Wi-Fi and a Home Assistant host. **Resolve the source’s WS2812 parts / WS2813 configuration mismatch**, select the actual strip length and power, and record a working ESPHome version. The guide’s other board examples are separate projects. |
| **Make it measure: a wireless light meter.** A sensor reports light intensity to a separate OLED display. | **2× base XIAO ESP32S3**, two XIAO Expansion Bases with Grove OLED, Grove TSL2561 and cable. Seeed provides server/client sketches and identifies Arduino, u8g2 and its sensor library in [BLE Sensor Data Exchange](https://wiki.seeedstudio.com/xiao_esp32s3_bluetooth/#ble-sensor-data-exchange). | Antennas, USB data/power and a programming computer are needed. The guide is older; record the board-package/library versions that actually compile. This is a two-board build, without a promised range, calibration accuracy or plant-health interpretation. |
| **Make it listen: fixed voice commands in Home Assistant.** Spoken commands change dashboard entities that a builder can use as inputs. | **1× base XIAO ESP32S3**, Grove Base for XIAO, Grove Offline Speech Recognizer, speaker and Grove cable; Home Assistant and ESPHome. Follow **demo 2** in [Seeed’s offline recognition guide](https://wiki.seeedstudio.com/Grove-Offline-Voice-Recognition/#demo2-grove-offline-voice-recognition-with-esphome-and-home-assistant). | USB power/programming, antenna, Wi-Fi and a Home Assistant host are required. The example publishes **virtual entity states**; actual appliance integration is additional work. Its recognition is fixed-command, not general conversation. Some instructions stray into C3 wording; confirm the S3 configuration and current ESPHome version before release. |

For the campaign, the visual proof would be the light changing, the remote reading appearing, or a recognized command changing the dashboard. Use an approved existing recording or a builder’s actual result. A rendered screen is not evidence that a build worked. No new demonstration footage is promised in the source-based production fee.

## The exchange that makes participation worthwhile

### What the creator receives

- A companion under their chosen credit, linking the original project and their existing commercial links, plus editable files they can use on their own site.
- A clear reply to recurring “which parts and version?” questions, with the separate required accessories visible.
- A small **proposed $200 honorarium per creator**, paid by the commissioning maker, for approved existing media, one bounded factual review and reuse permission. This is a budget to negotiate, not a claim about anyone’s rates. Cap requested review work at two hours; original filming and firmware repair require a different agreement.
- A credited card for a real viewer adaptation if one appears during the observation period. The original creator and adapting builder each approve their own representation and choose whether to post it.

The maker can supply its own documented project authors or introduce consenting creators with existing builds. The articles’ attribution is a source credit, not a recruited roster. No creator is required to migrate their audience or praise the board. A sample alone is not compensation for unlimited work. Affiliate approval is separate, and existing creator links stay intact.

### What the maker would fund

**Proposed production fee: $2,250 for three defined $750 companion pages.** Each retains the current pilot’s bounded media, parts, source, review and handoff limits. Supply one small series index linking the three outcomes using the same layout components. Each page gets an exportable parts/reference list and one share design in three crops. The maker receives a source/revision checklist and the seven-day demand-test decision sheet.

Each page has one current hardware/firmware path, one named technical reviewer and one consolidated review. Stage delivery sequentially; the existing five-working-day production clock applies to each complete, agreed page. **The seven-day experiment is a demand test, not a promise to finish three commissioned pages in seven days.** Hardware reproduction, firmware repair, new filming, custom checkout and ongoing maintenance are excluded from this production quote.

Propose $375 to start each agreed page and $375 after acceptance, following the existing pilot terms. Seek written approval of the series budget, but report money only when received. One paid page validates only that page; it is not three customers or proof of a repeat business.

Additional maker-controlled budgets: **up to $600 total creator honoraria and $75 direct expenses**, with prior scope agreement. Maximum proposed maker outlay: **$2,925**. Honoraria and reimbursed costs are tracked separately from our $2,250 production fee. No ad spend, giveaways, hardware purchases or affiliate income are assumed.

## Distribution: attach to work people already see

Before accepting the full series, ask the buyer to name **one actual owned placement** it is willing to provide: an existing XIAO newsletter slot, relevant project/product page or social post. Ask each participating creator whether they would voluntarily place their companion beneath the original project or in a pinned reply. Names, dates and permissions must be confirmed; published program benefits are not a placement booking.

Each post leads with its own result and credits its builder. A small end card offers the other two jobs. The index links back to every original guide and creator; it does not become a new mandatory account or store. The parts export identifies the base board, quantities, what the viewer already owns and what is missing. All purchases remain at the existing merchant.

The proposed caption is: **“I gave this board a job: [actual result]. These are the exact parts and version. What would you make with yours?”** Funding and any affiliate arrangement must be disclosed truthfully. Participation honoraria buy the agreed work, not an undisclosed testimonial. Creator reposts that are paid obligations are counted as paid placement, not voluntary distribution.

For an actual adaptation, manually prepare one “original → my version” card after the builder supplies their result and grants reuse. Record the real change, such as placement or enclosure, and preserve both credits. Do not award badges for merely saving a link, invent a completed build or offer prizes during this test.

## Seven-day manual demand test

The clock starts after there is explicit outreach authorization and permission to show the sample. Use the existing standalone maker demo to demonstrate the format, explicitly identifying its Wio example as a different board. A short private document can present the three XIAO choices and the scoped quote. **Do not build three unpaid custom pages or a challenge platform.**

| Day | Bounded action | Evidence |
| --- | --- | --- |
| **1** | Finish a one-page concept brief with the three source links, quantities, blockers, the quote and one relevant question for the buyer: which existing project attracts repeated parts/setup questions? Limit speculative preparation to two hours. | Source sheet, actual sample, time log and the buyer hypothesis. |
| **2** | Make one tailored approach to the official XIAO team through an authorized channel. Request a short scope review and one possible owned placement. Make at most three individually relevant creator-review invitations. | Actual sends, replies, commercial decision-maker and permission status. No reply is not a rejection. |
| **3** | Show the three choices to **12 consenting relevant hobbyists**, prioritizing owners of the exact base board; record ownership and prerequisites. Ask each to choose one or none, inspect its parts and name the first missing item. No voting incentive. | Individual choice, reason, existing parts, missing parts and a verbatim objection. These are research participants, not measured public reach. |
| **4** | Ask the maker whether the selected paths solve a current job and whether it will approve the production budget. Resolve the three release gates with its technical reviewer. Ask creators for exact versions and permission for existing assets. | Written scope/budget response and a clear pass/fail for each technical/media dependency. |
| **5** | Give participants their chosen official guide and a plain-text parts reference through their already agreed channel. Ask them to use it. A willing creator may place the approved source reference under an existing project. | Actual guide/reference use, a identified missing part, store inspection, configuration attempt or build start. Record what happened, not just “would try.” |
| **6** | Follow up once with consenting participants. Inspect volunteered setup evidence or a concrete blocker. If a completed adaptation exists, seek permission for one credited card. | Build start and completion recorded separately; any actual voluntary placement or referral. No repeat nudging to inflate numbers. |
| **7** | Present one decision sheet to the maker. Request the first scoped $375 start payment only through a separately agreed real billing process. Decide whether to begin the first paid page, revise the premise or stop expanding this experiment. | Written decisions, collected cash, costs and hours. The current local form is not an invoice or submission service. |

Recruitment may take longer than seven days. If the buyer has not responded or 12 relevant participants have not been reached, mark the result **inconclusive** and pause new production. Extend observation once for up to seven days without expanding scope or spending; do not treat an empty denominator as success or failure.

## Predetermined go / no-go rules

These are deliberately small decision thresholds chosen for this test, not industry conversion benchmarks.

| Gate | Continue when | Otherwise |
| --- | --- | --- |
| **Paid demand** | A real maker approves a defined first $750 scope and its intended placement, and the **$375 start payment is actually received**. Seek written interest in the other two pages separately. | No custom production without a funded first scope. An affiliate invitation, gifted sample or friendly reaction is not service revenue. No commitment to the remaining pages means no claim that the series sold. |
| **Useful choice** | Of 12 qualified reviewers, **at least 5** choose a feasible path after seeing its extra parts, and **at least 3 distinct people** perform and report a concrete next action by follow-up. | If fewer than 3 can identify a worthwhile next step, stop this three-path pitch. If people want a path but lack costly prerequisites, narrow the prerequisites or audience before trying again. |
| **Creator use** | **At least 2 creators** agree they would use their accurate, credited companion in an existing channel; at least **1 actual voluntary placement** is observed when an approved reference is available. | Permission to quote a creator is not distribution. If creators prefer their original guide and decline the companion, rework the utility before producing all three pages. |
| **Feasible production** | The first paid page fits **10 total allocated hours**, including sales/review; source conflicts and media rights are resolved before delivery. | At 8 production hours, inspect remaining work against scope. Re-scope rather than silently doing firmware engineering. Pause series expansion if a page exceeds 12 total hours. |

**Go means begin one paid page.** Produce the remaining two only when individually funded, their source gates pass and the first delivery is accepted. Two creator agreements and three viewer actions do not establish virality. No completed adaptation during the week is not automatically a failure; it means the proposed second sharing step is still unproven.

Use a small manual ledger: participant/source; board owned; chosen path; missing part; observed action and date; source blocker; creator permission; actual placement; paid/voluntary status; buyer scope; received payment; direct costs; production hours; next decision. Keep click counts, self-reports, physical builds and merchant-confirmed orders separate. Do not invent traffic analytics or payable referral attribution; no new tracking system is needed for this test.

## Costs and practical limits

- **Before a buyer commits:** cap speculative preparation, qualified conversations and manual owner review at **6 hours total**. At an illustrative internal $50/hour, that is $300 of time at risk, not cash received or a market quote. If recruitment exceeds that cap, pause and reassess access rather than automate unsolicited messages.
- **Full production target:** 24 production hours plus 4 allocated sales/coordination hours = **28 hours**. At $50/hour, labor is $1,400 against the $2,250 service fee, leaving $850 before overhead and tax when the maker pays the separately agreed direct costs. Include unsuccessful sales time in this allocation. If 6 pre-sale hours are additive rather than included, contribution falls to $550. At 45 total hours the production fee is fully consumed by modeled labor.
- **Creator supply is a real gate:** a $200 existing-media/review honorarium may be insufficient, and no creator has accepted it. Reduce the series to a funded feasible page or revise the quote; do not disguise samples as paid work.
- **Old examples may need repair:** the LED and voice source conflicts and library age are known dependencies. Link upstream and ask for a working revision; repairing firmware is outside this experiment. No “tested” badge follows from reading a wiki.
- **Low-cost boards can make sales-only economics weak:** the buyer may care about accessory purchases, fewer repeated questions or reuse of existing content. Ask which benefit is worth paying for. None has been measured. No discount or affiliate return is included in the business case.
- **Three jobs may be too diffuse:** owners with no Home Assistant setup may choose only the wireless meter, while its two-board requirement may deter others. That is useful rejection evidence. Record it rather than broadening to more boards during the week.
- **No result media, no finished-project claim:** approved existing material or actual participant evidence is needed for a project showcase. The licensed base-board photo can introduce the concept but cannot stand in for three completed builds.

The useful outcome of this experiment is small and concrete: **one maker pays for a real page, a creator has a reason to use it, and owners take a next step with the correct parts.** The board catalog supplies the common reference; the build results supply the reason to share.
