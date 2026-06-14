export const PRESET_PROMPT_COPY_KEYS = {
  aiImageStudio: {
    hint: 'chat.presets.aiImageStudio.hint',
    title: 'chat.presets.aiImageStudio.title',
  },
  cryptoPortfolio: {
    hint: 'chat.presets.cryptoPortfolio.hint',
    title: 'chat.presets.cryptoPortfolio.title',
  },
  customerSupportInbox: {
    hint: 'chat.presets.customerSupportInbox.hint',
    title: 'chat.presets.customerSupportInbox.title',
  },
  developerDocsPortal: {
    hint: 'chat.presets.developerDocsPortal.hint',
    title: 'chat.presets.developerDocsPortal.title',
  },
  ecommerceProductPage: {
    hint: 'chat.presets.ecommerceProductPage.hint',
    title: 'chat.presets.ecommerceProductPage.title',
  },
  educationCourseHub: {
    hint: 'chat.presets.educationCourseHub.hint',
    title: 'chat.presets.educationCourseHub.title',
  },
  eventTicketing: {
    hint: 'chat.presets.eventTicketing.hint',
    title: 'chat.presets.eventTicketing.title',
  },
  fitnessCoaching: {
    hint: 'chat.presets.fitnessCoaching.hint',
    title: 'chat.presets.fitnessCoaching.title',
  },
  foodDeliveryTracker: {
    hint: 'chat.presets.foodDeliveryTracker.hint',
    title: 'chat.presets.foodDeliveryTracker.title',
  },
  healthcareAppointment: {
    hint: 'chat.presets.healthcareAppointment.hint',
    title: 'chat.presets.healthcareAppointment.title',
  },
  hrHiringPipeline: {
    hint: 'chat.presets.hrHiringPipeline.hint',
    title: 'chat.presets.hrHiringPipeline.title',
  },
  mobileBankingOnboarding: {
    hint: 'chat.presets.mobileBankingOnboarding.hint',
    title: 'chat.presets.mobileBankingOnboarding.title',
  },
  musicFestivalGuide: {
    hint: 'chat.presets.musicFestivalGuide.hint',
    title: 'chat.presets.musicFestivalGuide.title',
  },
  podcastDiscovery: {
    hint: 'chat.presets.podcastDiscovery.hint',
    title: 'chat.presets.podcastDiscovery.title',
  },
  projectSprintBoard: {
    hint: 'chat.presets.projectSprintBoard.hint',
    title: 'chat.presets.projectSprintBoard.title',
  },
  realEstateSearch: {
    hint: 'chat.presets.realEstateSearch.hint',
    title: 'chat.presets.realEstateSearch.title',
  },
  restaurantReservation: {
    hint: 'chat.presets.restaurantReservation.hint',
    title: 'chat.presets.restaurantReservation.title',
  },
  saasAnalyticsDashboard: {
    hint: 'chat.presets.saasAnalyticsDashboard.hint',
    title: 'chat.presets.saasAnalyticsDashboard.title',
  },
  smartHomeControl: {
    hint: 'chat.presets.smartHomeControl.hint',
    title: 'chat.presets.smartHomeControl.title',
  },
  travelPlanner: {
    hint: 'chat.presets.travelPlanner.hint',
    title: 'chat.presets.travelPlanner.title',
  },
} as const;

export type PresetPromptId = keyof typeof PRESET_PROMPT_COPY_KEYS;

export interface PresetPrompt {
  id: PresetPromptId;
  title: string;
  hint: string;
  icon: string;
  prompt: string;
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: 'saasAnalyticsDashboard',
    title: 'SaaS Analytics Dashboard',
    hint: 'Metrics, filters, charts, and team workflows',
    icon: 'SaaS',
    prompt: '请生成一个 SaaS 增长分析仪表盘，包含核心指标、趋势图、筛选器、团队协作状态和可执行洞察。',
  },
  {
    id: 'mobileBankingOnboarding',
    title: 'Mobile Banking Onboarding',
    hint: 'Secure signup flow for a finance app',
    icon: 'Bank',
    prompt: '请设计一个移动银行 App 的开户引导流程，覆盖身份验证、风险提示、账户选择和完成态。',
  },
  {
    id: 'aiImageStudio',
    title: 'AI Image Studio',
    hint: 'Prompt tools, gallery, history, and exports',
    icon: 'AI',
    prompt: '请生成一个 AI 图片创作工作台，包含提示词输入、风格参数、生成历史、作品画廊和导出操作。',
  },
  {
    id: 'developerDocsPortal',
    title: 'Developer Docs Portal',
    hint: 'API docs with examples and navigation',
    icon: 'Docs',
    prompt: '请设计一个开发者文档门户，包含 API 导航、代码示例、搜索、版本切换和快速开始页面。',
  },
  {
    id: 'ecommerceProductPage',
    title: 'Ecommerce Product Page',
    hint: 'Purchase path with rich product details',
    icon: 'Shop',
    prompt: '请生成一个电商商品详情页，突出商品图、规格选择、评价、库存状态、推荐搭配和购买流程。',
  },
  {
    id: 'travelPlanner',
    title: 'Travel Planner',
    hint: 'Itinerary, maps, budget, and bookings',
    icon: 'Trip',
    prompt: '请设计一个旅行规划工具，支持行程时间线、地图点位、预算统计、酒店航班信息和协同编辑。',
  },
  {
    id: 'healthcareAppointment',
    title: 'Healthcare Appointment',
    hint: 'Clinic booking with patient context',
    icon: 'Care',
    prompt: '请生成一个医疗预约页面，包含医生排班、科室筛选、患者信息、预约确认和就诊前提醒。',
  },
  {
    id: 'educationCourseHub',
    title: 'Education Course Hub',
    hint: 'Learning paths, lessons, and progress',
    icon: 'Learn',
    prompt: '请设计一个在线课程中心，包含课程路径、章节列表、学习进度、作业状态和推荐下一步。',
  },
  {
    id: 'realEstateSearch',
    title: 'Real Estate Search',
    hint: 'Listings, map results, and comparison',
    icon: 'Home',
    prompt: '请生成一个房源搜索体验，包含地图列表联动、筛选条件、房源对比、收藏和预约看房入口。',
  },
  {
    id: 'foodDeliveryTracker',
    title: 'Food Delivery Tracker',
    hint: 'Restaurant order and delivery status',
    icon: 'Food',
    prompt: '请设计一个外卖订单追踪页面，展示商家备餐、骑手路线、预计送达、订单明细和售后入口。',
  },
  {
    id: 'cryptoPortfolio',
    title: 'Crypto Portfolio',
    hint: 'Holdings, risk, market moves, and alerts',
    icon: 'Coin',
    prompt: '请生成一个加密资产组合面板，包含持仓分布、盈亏走势、风险提示、市场新闻和价格提醒。',
  },
  {
    id: 'hrHiringPipeline',
    title: 'HR Hiring Pipeline',
    hint: 'Candidate stages, notes, and decisions',
    icon: 'Hire',
    prompt: '请设计一个招聘流程看板，包含候选人阶段、面试安排、评审反馈、优先级和录用决策状态。',
  },
  {
    id: 'eventTicketing',
    title: 'Event Ticketing',
    hint: 'Venue, seats, checkout, and confirmation',
    icon: 'Tix',
    prompt: '请生成一个活动票务购买流程，包含场馆信息、座位选择、票档对比、结算和出票成功页。',
  },
  {
    id: 'smartHomeControl',
    title: 'Smart Home Control',
    hint: 'Rooms, devices, scenes, and energy use',
    icon: 'IoT',
    prompt: '请设计一个智能家居控制面板，展示房间设备、场景模式、能源消耗、异常提醒和快捷控制。',
  },
  {
    id: 'fitnessCoaching',
    title: 'Fitness Coaching',
    hint: 'Plans, habits, stats, and recovery',
    icon: 'Fit',
    prompt: '请生成一个健身教练 App 页面，包含训练计划、动作记录、身体指标、恢复建议和打卡反馈。',
  },
  {
    id: 'podcastDiscovery',
    title: 'Podcast Discovery',
    hint: 'Shows, episodes, queues, and recommendations',
    icon: 'Cast',
    prompt: '请设计一个播客发现页面，包含节目推荐、单集列表、播放队列、订阅状态和主题分类。',
  },
  {
    id: 'restaurantReservation',
    title: 'Restaurant Reservation',
    hint: 'Availability, party details, and ambience',
    icon: 'Dine',
    prompt: '请生成一个餐厅订位体验，包含日期人数选择、可用时段、餐厅氛围、菜单亮点和确认信息。',
  },
  {
    id: 'projectSprintBoard',
    title: 'Project Sprint Board',
    hint: 'Tasks, blockers, velocity, and owners',
    icon: 'Plan',
    prompt: '请设计一个项目 Sprint 看板，包含任务分组、负责人、阻塞风险、迭代速度和每日同步摘要。',
  },
  {
    id: 'musicFestivalGuide',
    title: 'Music Festival Guide',
    hint: 'Lineup, stages, schedule, and passes',
    icon: 'Fest',
    prompt: '请生成一个音乐节指南页面，包含阵容时间表、舞台地图、票证状态、收藏演出和现场服务。',
  },
  {
    id: 'customerSupportInbox',
    title: 'Customer Support Inbox',
    hint: 'Tickets, priority, replies, and SLA status',
    icon: 'Help',
    prompt: '请设计一个客服工单收件箱，包含会话列表、优先级、SLA 状态、回复编辑器和客户上下文。',
  },
];

export function pickPresetPrompts(rng: () => number = Math.random, count = 4): PresetPrompt[] {
  const pool = [...PRESET_PROMPTS];
  const selected: PresetPrompt[] = [];

  while (selected.length < count && pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
    const [prompt] = pool.splice(index, 1);
    selected.push(prompt);
  }

  return selected;
}
