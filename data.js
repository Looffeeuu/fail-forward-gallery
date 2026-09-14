const storyTagCatalog = [
  { value: "KaoyanRejection", labelEn: "#KaoyanRejection", labelZh: "#考研失利", boards: ["academic"] },
  { value: "AcademicProbation", labelEn: "#AcademicProbation", labelZh: "#学业警告", boards: ["academic"] },
  { value: "DropoutDecision", labelEn: "#DropoutDecision", labelZh: "#退学决定", boards: ["academic"] },
  { value: "CareerPivot", labelEn: "#CareerPivot", labelZh: "#职业转向", boards: ["academic"] },
  { value: "MajorDissatisfaction", labelEn: "#MajorDissatisfaction", labelZh: "#专业不适", boards: ["academic"] },
  { value: "ExamFailure", labelEn: "#ExamFailure", labelZh: "#考试失利", boards: ["academic"] },
  { value: "Qiuzhao0Offer", labelEn: "#Qiuzhao0Offer", labelZh: "#秋招零Offer", boards: ["job"] },
  { value: "InterviewAnxiety", labelEn: "#InterviewAnxiety", labelZh: "#面试焦虑", boards: ["job"] },
  { value: "LackOfInternship", labelEn: "#LackOfInternship", labelZh: "#缺少实习", boards: ["job"] },
  { value: "DegreeDiscrimination", labelEn: "#DegreeDiscrimination", labelZh: "#学历歧视", boards: ["job"] },
  { value: "CVStruggles", labelEn: "#CVStruggles", labelZh: "#简历困境", boards: ["job"] },
  { value: "LanguageBarrier", labelEn: "#LanguageBarrier", labelZh: "#语言障碍", boards: ["social"] },
  { value: "LonelinessAbroad", labelEn: "#LonelinessAbroad", labelZh: "#海外孤独", boards: ["social"] },
  { value: "CultureShock", labelEn: "#CultureShock", labelZh: "#文化冲击", boards: ["social"] },
  { value: "CityShock", labelEn: "#CityShock", labelZh: "#城市适应", boards: ["social"] },
  { value: "CannotGoHomeCannotStay", labelEn: "#CannotGoHomeCannotStay", labelZh: "#回不去也留不下", boards: ["social"] },
  { value: "CampusDiscrimination", labelEn: "#CampusDiscrimination", labelZh: "#校园歧视", boards: ["social"] },
  { value: "VisaIssues", labelEn: "#VisaIssues", labelZh: "#签证问题", boards: ["social"] },
  { value: "FamilyPressure", labelEn: "#FamilyPressure", labelZh: "#家庭压力", boards: ["academic", "job", "social"], crossBoard: true },
  { value: "FinancialStruggles", labelEn: "#FinancialStruggles", labelZh: "#经济压力", boards: ["academic", "job", "social"], crossBoard: true },
  { value: "ImposterSyndrome", labelEn: "#ImposterSyndrome", labelZh: "#冒充者综合征", boards: ["academic", "job", "social"], crossBoard: true },
  { value: "NoConnections", labelEn: "#NoConnections", labelZh: "#缺少人脉", boards: ["academic", "job", "social"], crossBoard: true },
  { value: "FirstGenPressure", labelEn: "#FirstGenPressure", labelZh: "#首代大学生压力", boards: ["academic", "job", "social"], crossBoard: true }
];

const storyTagsByBoard = {
  academic: storyTagCatalog
    .filter((tag) => !tag.crossBoard && tag.boards.includes("academic"))
    .map((tag) => tag.value),
  job: storyTagCatalog
    .filter((tag) => !tag.crossBoard && tag.boards.includes("job"))
    .map((tag) => tag.value),
  social: storyTagCatalog
    .filter((tag) => !tag.crossBoard && tag.boards.includes("social"))
    .map((tag) => tag.value)
};

const crossBoardTags = storyTagCatalog
  .filter((tag) => tag.crossBoard)
  .map((tag) => tag.value);

const stories = [
  {
    id: 1,
    title: "The Exam I Studied Two Years For",
    board: "academic",
    tags: ["KaoyanRejection", "FamilyPressure"],
    commentMode: "similar",
    commentModeLabel: "Hear Similar Experience",
    text: "I spent two years preparing for the postgraduate entrance exam. I rented a tiny room near my undergraduate campus, woke up at 6 a.m. every day, and memorised political theory flashcards until my eyes blurred. My parents told everyone in our village that their daughter was going to be a master's student at a top university. When the results came out, I missed the cutoff by three points. Three points, after 730 days. I could not get out of bed for a week. What hurt most was not the failure itself—it was calling my mother and hearing her voice crack as she said, \"It's okay, we still love you.\" I had never heard her sound so defeated. I am now working at a small company and slowly rebuilding my sense of self outside of exam scores. But every December, when kaoyan season comes around, my stomach still tightens.",
    attribution: "Anonymous, 23, Female, Rural Background",
    comments: [
      { type: "similar", author: "Anonymous", text: "I also missed my kaoyan cutoff by 2 points. It took me a year to stop measuring my worth by that number. You are not alone in this—the exam does not define who you become." },
      { type: "similar", author: "Anonymous", text: "Three points. That is so painfully close. I went through the same thing in 2023. The December anxiety never fully goes away, but it does get quieter. Sending you strength." }
    ]
  },
  {
    id: 2,
    title: "The Warning Letter I Hid from Everyone",
    board: "academic",
    tags: ["AcademicProbation", "ImposterSyndrome"],
    commentMode: "advice",
    commentModeLabel: "Gentle Advice",
    text: "In my second year, I failed four courses and received an academic probation notice. I was the top student in my high school—the one teachers pointed to and said, \"She will go far.\" But university felt like a different planet. Everyone seemed to understand the lectures effortlessly while I sat in the back row, drowning. I could not tell my parents. I paid a stranger RMB 100 on Xiaohongshu to pretend to be my mother on the phone with my academic advisor. I know how absurd that sounds now. The secret weighed on me for months until I finally broke down in front of my roommate, who—to my absolute shock—said she had also been on probation the previous year. That conversation saved me. I am still catching up on credits, but at least I am no longer hiding.",
    attribution: "Anonymous, 20, Male, Urban Background",
    comments: [
      { type: "advice", author: "Anonymous", text: "Thank you for your honesty. My suggestion: visit your university's academic support centre. Many offer free tutoring and study skills workshops. Also, consider talking to your academic advisor openly now—they have seen this before and can help you map out a recovery plan. You have already done the hardest part by admitting it." }
    ]
  },
  {
    id: 3,
    title: "350 Applications, Zero Offers",
    board: "job",
    tags: ["Qiuzhao0Offer", "InterviewAnxiety", "LackOfInternship"],
    commentMode: "encouragement",
    commentModeLabel: "Encouragement",
    text: "I started preparing for autumn recruitment in my third year. I polished my CV until every bullet point sparkled, practised self-introductions in front of the mirror, and applied to 350 companies across every platform—Zhaopin, 51job, Liepin, BOSS Zhipin. I got twelve interviews. Twelve chances. I was rejected after every single one. Some rejections came as polite emails; most were silence. The worst was a group interview where the HR manager glanced at my university name and visibly lost interest before I had spoken a single word. I started to believe the problem was me—that I was fundamentally unemployable. I spent three months in a fog of self-hatred. What pulled me out was a WeChat group of other \"qiuzhao losers\" where we shared job leads and dark humour. I eventually found a position through a referral from someone in that group. It is not my dream job, but it is a start.",
    attribution: "Anonymous, 22, Male, Urban Background",
    followUps: [
      {
        id: "follow-up-3-1",
        day: 30,
        status: "small-steps",
        text: "I still feel disappointed about the rejection, but I have started applying for other opportunities and talking to friends who had similar experiences. I am not fully over it, but I no longer feel that I have to face it alone.",
        textZh: "我仍然会因为被拒绝而感到失落，但我已经开始尝试申请其他机会，也和有类似经历的朋友聊了聊。我还没有完全走出来，但至少不再觉得自己只能独自面对。",
        support: "Talking with people who understand the experience has helped me feel less isolated.",
        supportZh: "和真正理解这种经历的人交流，让我不再那么孤立无援。",
        visibility: "public",
        reviewStatus: "approved",
        publishedLabel: "Published 30 days after the original story",
        publishedLabelZh: "发布于原故事的第30天",
        source: "sample"
      }
    ],
    comments: [
      { type: "encouragement", author: "Anonymous", text: "You are not unemployable—you are navigating one of the toughest job markets in years. The fact that you kept going after 350 applications says everything about your resilience. That quality will serve you far longer than any single job offer. Keep going." },
      { type: "encouragement", author: "Anonymous", text: "350 applications and you did not give up. That is extraordinary perseverance. The right door will open—and when it does, you will be more prepared than anyone who had it easy. Rooting for you." }
    ]
  },
  {
    id: 4,
    title: "The 'Ordinary' University Label",
    board: "job",
    tags: ["DegreeDiscrimination", "CVStruggles"],
    commentMode: "advice",
    commentModeLabel: "Gentle Advice",
    text: "I graduated from a \"double non-elite\" university—not 985, not 211, not \"double first-class.\" During a job fair, I handed my CV to a recruiter who took one look at the university name, set it aside, and said, \"We are really looking for candidates from stronger academic backgrounds.\" She said it politely, almost kindly, which somehow made it worse. I had worked so hard—student council president, two internships, a 3.8 GPA—and none of it mattered because of a four-hour exam I took when I was eighteen. I walked out of that job fair, sat on a bench outside, and cried for twenty minutes. A security guard came over and asked if I was okay. I told him I was fine, but I was not fine. I am now doing a short-term training programme in digital marketing, trying to build skills that speak louder than my diploma. Some days I feel hopeful; other days the label still stings.",
    attribution: "Anonymous, 22, Female, Urban Background",
    comments: [
      { type: "advice", author: "Anonymous", text: "That recruiter's behaviour says more about their bias than your worth. Practical suggestion: build a portfolio of real projects—case studies, campaign analyses, data dashboards—that demonstrate your skills directly, bypassing the résumé filter. Many companies now use skills-based hiring. Also look into industry certifications (Google, HubSpot) that add third-party validation to your profile." }
    ]
  },
  {
    id: 5,
    title: "No Connections, No Direction",
    board: "job",
    tags: ["NoConnections", "FirstGenPressure", "LackOfInternship"],
    commentMode: "similar",
    commentModeLabel: "Hear Similar Experience",
    text: "I am the first person in my family to attend university. My parents are farmers who have never written a CV. When I asked them for career advice, my father said, \"Work hard and be a good person.\" I love him for that, but it does not help me navigate corporate recruitment. My classmates talk about \"my father's colleague at Huawei\" or \"my aunt who works at Tencent\"—I have no such network. I did not even know what an \"internship\" was until my third year, by which point my classmates from better-connected families had already completed two. I spent weeks scrolling through Xiaohongshu, watching privileged kids share their perfectly curated career paths, and felt like I had shown up to a race where everyone else had been given a map and I had been given a blank piece of paper. I am still figuring it out. Some days I am angry; other days I am just tired.",
    attribution: "Anonymous, 21, Male, Rural Background, First-Generation College Student",
    comments: [
      { type: "similar", author: "Anonymous", text: "First-gen here too. I did not know what LinkedIn was until my senior year. The blank map metaphor is exactly right. What helped me was finding one or two professors who came from similar backgrounds and asking them for guidance. They understood in ways my classmates never could. You are not behind—you are on a different path." }
    ]
  },
  {
    id: 6,
    title: "The Price of Being 'The Village Hope'",
    board: "social",
    tags: ["FinancialStruggles", "FirstGenPressure", "CityShock"],
    commentMode: "encouragement",
    commentModeLabel: "Encouragement",
    text: "When I got into a 985 university, my village held a banquet. My grandmother, who cannot read, held my admission letter and wept. I was \"the hope of the village.\" Then I arrived on campus. My roommate had an iPad, a MacBook, and a wardrobe full of branded clothes. I had a second-hand Lenovo and three pairs of shoes, one with a hole I hid with insoles. The first time my classmates suggested getting bubble tea together, I said I was not thirsty. The truth was RMB 20 was my food budget for an entire day. I skipped social events, avoided group dinners, and gradually became invisible. The loneliness of being surrounded by people but belonging to none of their worlds is hard to describe. I have since found a part-time library job and a small group of friends who do not care about brands. But I still flinch when someone suggests an expensive outing, and I still have not told anyone about the shoes.",
    attribution: "Anonymous, 20, Female, Rural Background, First-Generation College Student",
    comments: [
      { type: "encouragement", author: "Anonymous", text: "You made it to a 985 university from a village. Do you know how incredible that is? The shoes with the hole—that is not a mark of shame. It is a mark of someone who has walked further than most people ever will. Keep walking. You are already the hope your grandmother saw in you." },
      { type: "encouragement", author: "Anonymous", text: "I see you. I was that student too—the one who skipped meals to save money, who never had the right clothes. You are building a life from the ground up, and that kind of strength is something no branded wardrobe can buy. Proud of you." }
    ]
  },
  {
    id: 7,
    title: "Two Worlds, Neither Home",
    board: "social",
    tags: ["CannotGoHomeCannotStay", "CampusDiscrimination", "FamilyPressure"],
    commentMode: "similar",
    commentModeLabel: "Hear Similar Experience",
    text: "I grew up in a village where the only toilet was a pit latrine and \"hot water\" meant boiling a kettle. Now I study at a university where students complain about the air conditioning being one degree too warm. When I go home during holidays, my relatives joke that I have \"become a city person\" and cannot handle village life anymore. When I am at university, I am the \"rural student\" who does not know how to use a coffee machine or what \"gap year\" means. I exist in a permanent state of cultural translation, never fully legible in either world. Last Spring Festival, my mother asked me to stop \"talking like a book\" because my vocabulary had changed and she could not understand me. I cried in the outhouse so no one would hear. This is a loneliness that has no name in either language I speak.",
    attribution: "Anonymous, 21, Female, Rural Background",
    comments: [
      { type: "similar", author: "Anonymous", text: "This made me cry. I have never seen this feeling put into words before. The 'cultural translation'—yes, exactly that. Every conversation is a negotiation between who you were and who you are becoming. You are not alone in this in-between space." },
      { type: "similar", author: "Anonymous", text: "I thought I was the only one who felt this way. My mother also tells me I 'talk like a book' now. It breaks something inside every time. But I think maybe we are not losing our home—we are expanding what home can mean. Thank you for writing this." }
    ]
  },
  {
    id: 8,
    title: "The Silent Exchange Student",
    board: "social",
    tags: ["LanguageBarrier", "LonelinessAbroad", "CultureShock"],
    commentMode: "advice",
    commentModeLabel: "Gentle Advice",
    text: "I am a Chinese exchange student at a university in the United Kingdom. My IELTS score was 7.0, which should mean I can communicate. But in seminar rooms, by the time I have formulated a sentence in my head, the conversation has moved on. I sit there, nodding, terrified the professor will call on me. My classmates probably think I am shy or unprepared. The truth is I am neither—I have thoughts, opinions, things I desperately want to say—but they are locked inside a Chinese-speaking brain in an English-speaking room. Outside class, I eat most meals alone. The British students are friendly but their conversations move too fast, full of cultural references I do not share. The other Chinese students seem to have formed close groups I cannot break into. I spend evenings scrolling through Xiaohongshu, watching other people live their lives, feeling like a ghost in my own.",
    attribution: "Anonymous, 22, Female, Chinese Exchange Student in the UK",
    comments: [
      { type: "advice", author: "Anonymous", text: "Your IELTS 7.0 means your English is strong—the issue is not ability but processing time, which is completely normal for second-language speakers. Try preparing 2-3 points before seminars, and give yourself permission to speak slowly. Also, many UK universities have conversation partner programmes that pair international and local students—worth checking. For the social side, try joining a society based on an activity (hiking, cooking, board games) rather than just socialising—shared activity reduces language pressure." }
    ]
  },
  {
    id: 9,
    title: "The Scholarship That Disappeared",
    board: "social",
    tags: ["VisaIssues", "FinancialStruggles", "LonelinessAbroad"],
    commentMode: "none",
    commentModeLabel: "No Comments",
    text: "I was accepted to a master's programme in the United States with a partial scholarship. My parents emptied their savings to cover the rest. Three weeks before my flight, the scholarship was cancelled due to funding cuts. I had already quit my job in China, given up my apartment, and told everyone I was leaving. The visa was approved. The dream was real—and then it was not. I spent two months in a haze, unable to tell my parents the money they had saved for thirty years was now at risk. I eventually found another, smaller scholarship at a different university, but the shame of that near-miss still sits in my chest. I am now halfway through my programme abroad, and while I am grateful, I carry a constant, low-grade terror that everything could disappear again at any moment.",
    attribution: "Anonymous, 24, Male, Chinese International Student in the US",
    comments: []
  },
  {
    id: 10,
    title: "The Dropout Who Found Another Way",
    board: "academic",
    tags: ["DropoutDecision", "CareerPivot", "MajorDissatisfaction"],
    commentMode: "similar",
    commentModeLabel: "Hear Similar Experience",
    text: "I was accepted into a prestigious graduate programme through the recommendation (baoyan) system. My parents were overjoyed; my undergraduate professors wrote glowing reference letters. Six months in, I realised I was deeply, fundamentally miserable. The research direction felt meaningless to me, my supervisor was absent, and I was having panic attacks before every group meeting. I dropped out. The word \"dropout\" in Chinese—tuixue—sounds like a diagnosis. My father did not speak to me for three months. I spent half a year feeling like the world's biggest disappointment. Then, almost on a whim, I started a small online business selling handmade ceramics—something I had always loved but never considered a \"real career.\" It is not what anyone expected of me, least of all myself. I earn less than I would have with a master's degree, but I no longer wake up dreading the day ahead. I am learning that \"success\" might be a smaller, quieter thing than I was taught.",
    attribution: "Anonymous, 24, Male, Urban Background",
    comments: [
      { type: "similar", author: "Anonymous", text: "I also dropped out of a baoyan programme. The shame was overwhelming—I did not leave my apartment for weeks. It has been two years now and I run a small café. I make less money than my former classmates, but I smile more. Some of us need to define success on our own terms. Welcome to the club." }
    ]
  }
];

const adviceArticles = [
  {
    id: "advice-1",
    title: "What to Do When You Miss the Kaoyan Cutoff",
    titleZh: "考研未过线后，可以先做什么",
    tags: ["KaoyanRejection", "ExamFailure"],
    board: "academic",
    summary: "The postgraduate entrance exam is one of the most competitive in the world. Missing the cutoff does not define your intelligence or your future—here are five concrete steps to move forward.",
    summaryZh: "考研结果不能定义你的能力或未来。下面是五个可以逐步考虑的行动方向，你也可以按照自己的节奏选择是否尝试。",
    steps: [
      "Give yourself a structured grieving period (1-2 weeks). Set a date on your calendar when you will start planning next steps. This prevents indefinite rumination.",
      "Audit your result strategically. Were you close to the cutoff? Consider retaking with a more focused study plan. Was the gap large? Consider whether this path truly aligns with your strengths.",
      "Explore parallel pathways: many industries value work experience over postgraduate degrees. Research companies in your field that offer graduate trainee programmes.",
      "Reach out to 2-3 people who took alternative paths after kaoyan—alumni networks and LinkedIn are good sources. Hearing real trajectories reduces catastrophising.",
      "Remember: the exam measures exam-taking ability at one moment in time. It does not measure creativity, emotional intelligence, resilience, or your capacity to grow."
    ],
    stepsZh: [
      "允许自己经历一段有边界的难过期，例如先给自己一到两周，再约定一个开始整理下一步的日期。重点不是催促自己振作，而是避免长期陷在反复自责中。",
      "客观复盘分数与准备过程。如果距离分数线很近，可以评估是否愿意以更聚焦的计划再尝试；如果差距较大，也可以重新考虑这条路径是否符合自己的兴趣、资源与优势。",
      "了解平行路径。许多行业更看重实际经历和能力，可以关注校招培训项目、实习、技能作品集或其他继续学习方式。",
      "联系两三位考研后选择不同道路的人，例如可信任的学长学姐或校友。看到真实而多样的成长路径，有助于减轻‘只有这一条路’的压力。",
      "记住：一次考试只测量某个时点的应试表现，无法完整衡量创造力、人际能力、韧性和持续成长的能力。"
    ]
  },
  {
    id: "advice-2",
    title: "Rebuilding Confidence After Qiuzhao Rejection",
    titleZh: "秋招受挫后，如何慢慢找回信心",
    tags: ["Qiuzhao0Offer", "InterviewAnxiety"],
    board: "job",
    summary: "Autumn recruitment rejection is often a structural problem, not a personal one. Here is how to protect your mental health while continuing your search.",
    summaryZh: "秋招结果同时受到岗位数量、筛选机制和市场环境影响，并不等同于个人价值。下面是一些兼顾求职与身心状态的做法。",
    steps: [
      "Decouple your self-worth from recruitment outcomes. Chinese graduates face one of the highest applicant-to-opening ratios in history. Rejection is the statistical norm, not a personal verdict.",
      "Diversify your job search channels. Beyond Zhaopin and 51job, try: industry-specific WeChat groups, alumni referrals, small and medium enterprises (which often have less rigid screening), and spring recruitment (chunzhao), which has less competition.",
      "Practise interview skills with peers. Record yourself answering common questions. You will notice filler words, pacing issues, and areas to strengthen—objective self-observation beats anxious self-criticism.",
      "Set a daily application cap (e.g., 5 quality applications) rather than mass-applying. Tailored applications yield higher response rates and reduce burnout.",
      "Build a 'rejection resilience' ritual: after each rejection, do one small thing that reminds you of your competence—review past praise, work on a personal project, exercise."
    ],
    stepsZh: [
      "尝试把自我价值与招聘结果分开。竞争激烈时，被拒绝往往是统计上的常态，而不是对一个人的最终评价。",
      "分散求职渠道。除了大型招聘平台，也可以关注行业社群、校友内推、中小企业和竞争相对较低的春招机会。",
      "和同伴进行模拟面试并录音或录像，观察语速、口头禅和回答结构。用可观察的问题代替笼统的自我否定。",
      "为每天的申请数量设定上限，例如完成五份有针对性的申请，而不是无限投递，以减少耗竭。",
      "每次收到拒绝后，安排一件能够提醒自己仍有能力的小事，例如回顾曾获得的积极反馈、推进个人项目或进行适度运动。"
    ]
  },
  {
    id: "advice-3",
    title: "Managing Loneliness as an Exchange Student",
    titleZh: "交换学习期间，如何面对孤独与文化适应",
    tags: ["LonelinessAbroad", "LanguageBarrier", "CultureShock"],
    board: "social",
    summary: "Loneliness abroad is not a personal failing—it is a predictable phase of cultural adaptation. Here are strategies that work.",
    summaryZh: "在海外感到孤独不代表你不擅长社交，它可能是文化适应过程的一部分。以下做法可以作为参考。",
    steps: [
      "Understand the W-curve of cultural adjustment: initial excitement, then crash, then gradual adaptation, another dip, and finally integration. Knowing this is normal reduces self-blame.",
      "Join one structured activity where language is secondary: sports clubs, hiking groups, maker spaces, volunteering. Shared activity creates natural interaction without the pressure of small talk.",
      "Use your university's international student services. Many offer free conversation partner programmes, cultural orientation sessions, and counselling specifically for international students.",
      "Create a balanced communication diet: schedule regular but not constant contact with home (e.g., one video call per week, not daily), leaving space to build local connections.",
      "Give yourself permission to be a beginner. You are learning a new culture the way a child learns—through observation, mistakes, and gradual confidence. The silent phase is temporary."
    ],
    stepsZh: [
      "了解文化适应可能出现反复：兴奋、失落、逐渐适应、再次波动，再到形成新的平衡。知道情绪变化并不少见，可以减少自责。",
      "参加一种语言压力较低的结构化活动，例如运动、徒步、手工活动或志愿服务。共同完成事情比单纯寒暄更容易建立连接。",
      "了解学校的国际学生支持服务，例如语言伙伴、文化适应活动和面向国际学生的咨询资源，并确认服务是否适合自己。",
      "在与家乡保持联系和建立当地生活之间寻找平衡，例如安排固定的视频通话，而不是让线上联系占满全部空闲时间。",
      "允许自己暂时是新手。理解新的文化需要观察、试错和时间，沉默或不确定的阶段不等于失败。"
    ]
  },
  {
    id: "advice-4",
    title: "Navigating Campus as a First-Generation Student",
    titleZh: "第一代大学生如何逐步熟悉校园规则",
    tags: ["FirstGenPressure", "FinancialStruggles", "CityShock"],
    board: "social",
    summary: "Being the first in your family to attend university is an extraordinary achievement—and it comes with unique challenges. Here is how to find your footing.",
    summaryZh: "成为家庭中的第一代大学生是一项重要经历，也常伴随信息、资源和文化适应上的独特困难。以下建议用于帮助你逐步找到自己的位置。",
    steps: [
      "Identify 'cultural capital' gaps without shame. Not knowing what an internship is, how to network, or what 'gap year' means is not a personal deficiency—it is information your environment never provided. Treat these as skills to learn, not evidence of inadequacy.",
      "Find a mentor from a similar background. Look for professors, teaching assistants, or senior students who were also first-gen. They understand your context in ways others cannot.",
      "Utilise free university resources aggressively: career counselling, mental health services, academic skills workshops, language labs. These exist precisely to level the playing field.",
      "Build a 'translation' practice between your two worlds. When you go home, share what you are learning in accessible language. When at university, allow yourself to be curious about things you do not know without apology.",
      "Remember: your background gives you perspectives your classmates lack. Resilience, resourcefulness, and the ability to navigate uncertainty are assets employers value—you have been developing them your whole life."
    ],
    stepsZh: [
      "不带羞耻地识别信息差。不熟悉实习、社交网络或间隔年等概念，并不是个人缺陷，而是过去环境没有提供相应信息。",
      "寻找背景相近的导师、老师、助教或高年级学生。他们可能更理解你正在面对的处境。",
      "主动了解学校提供的免费资源，例如就业咨询、心理支持、学习技能工作坊和语言中心，并核实服务的申请方式。",
      "练习在家庭与校园之间进行‘翻译’：回家时用家人熟悉的方式分享经历；在学校遇到陌生规则时，允许自己提问而不必为不知道而道歉。",
      "你的成长背景也带来了独特视角。应对不确定性、解决现实问题和利用有限资源的能力，都是可以继续发展的优势。"
    ]
  },
  {
    id: "advice-5",
    title: "Dealing with Degree Discrimination in Job Applications",
    titleZh: "求职中遇到学历筛选时，可以采取哪些策略",
    tags: ["DegreeDiscrimination", "CVStruggles"],
    board: "job",
    summary: "When recruiters filter by university prestige, your CV may never reach a human reader. Here are strategies to work around structural bias.",
    summaryZh: "当招聘流程过度依赖学校背景筛选时，个人经历可能没有机会被完整看见。下面是一些应对结构性偏见的现实策略。",
    steps: [
      "Build a skills-based portfolio that speaks louder than your diploma: GitHub repositories for tech roles, case study write-ups for business roles, a professional blog demonstrating industry knowledge.",
      "Target companies known for skills-based hiring. Many tech firms, startups, and foreign-invested enterprises evaluate candidates through practical assessments rather than credential screening.",
      "Leverage the back door: employee referrals bypass HR filters. Use alumni networks, industry events, and LinkedIn to connect with people inside your target companies before applying.",
      "Pursue industry certifications (PMP, CPA, CFA Level 1, Google Career Certificates) that provide standardised, third-party validation of your competence independent of your university.",
      "Reframe your narrative: in cover letters and interviews, lead with what you have done and built, not where you studied. Let your work speak first."
    ],
    stepsZh: [
      "建立以能力为核心的作品集，例如技术岗位的代码项目、商业岗位的案例分析，或能够体现专业思考的公开文章。",
      "关注更重视技能评估的公司和岗位。部分科技企业、初创公司和外资企业会通过实际任务而不是单纯学历进行筛选。",
      "通过校友网络、行业活动和职业社交平台联系目标公司的从业者。合适的内部推荐有时可以减少简历在初筛阶段被忽略的概率。",
      "根据目标行业评估是否需要具有可信度的职业资格或技能认证，不要为了堆砌证书而投入超出自身承受范围的成本。",
      "在求职信和面试中优先说明自己做过什么、解决过什么问题，再介绍学校背景，让具体成果先被看见。"
    ]
  }
];
