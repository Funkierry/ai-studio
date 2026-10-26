export function collaborationRoles({ planner, backend, frontend, tester }) {
  return [
    { name:'需求规划', who:planner, deps:[], gate:true, out:'需求文档（PRD）与协作约定',
      desc:'根据项目目标给前后端同事写可直接实施的共同约定：数据结构、接口路径、请求响应示例、校验规则、错误状态、页面流程和验收清单。明确文件归属，前端只负责 web/，后端负责 server/、docs/API.md、package.json，测试负责 tests/ 和最终 README.md。不要替同事实现代码；范围不清时列出问题，交付后先由老板确认。' },
    { name:'后端开发', who:backend, deps:[0], gate:false, out:'server/、docs/API.md、package.json',
      desc:'读取需求同事的交付，严格按共同约定实现后端和静态页面服务，只修改 server/、docs/API.md、package.json。使用 Node 内置模块；server/index.js 导出 {server}，直接执行时才 listen，支持 PORT 与 DB_FILE。不要修改 web/ 或 README.md。在交付文档列出给前端和测试的接口示例、启动方式及已知限制。' },
    { name:'前端开发', who:frontend, deps:[0], gate:false, out:'web/ 页面代码',
      desc:'读取需求同事的交付，严格按共同约定实现 web/ 中的原生 HTML/CSS/JavaScript。只修改 web/，用相对 URL 调真实后端接口，不用假数据代替接口，不修改 server/、package.json 或 README.md。提供加载、空列表和出错状态；在交付文档逐项说明接口如何使用，供测试同事联调。' },
    { name:'集成测试', who:tester, deps:[0,1,2], gate:false, out:'tests/ 自动化测试、README.md 与测试报告',
      desc:'同时读取需求文档和前后端同事的实际代码，核对双方接口并运行 node:test 测试真实实现。测试放在 tests/，对真实后端用临时数据库及 server.listen(0) 配合 fetch，覆盖正常流程和边界，不得复制业务代码充当测试。检查前端调用是否匹配；只修改 tests/ 与 README.md，不替同事重写业务代码。发现问题用失败断言保留证据，报告具体责任分工、文件、复现步骤和预期结果，交回老板安排返工。README 写清启动和测试方法。' },
  ];
}

export function collaborationWorkorder(title, goal, roles, employees) {
  const person = id => employees.find(e=>e.id===id)?.name || id;
  return [`# ${title}`, '', '## 项目目标', goal, '', '## 协作分工',
    ...roles.flatMap((role,index)=>[
      `### ${index+1}. ${role.name} · ${person(role.who)}`,
      `开始条件：${role.deps.length?role.deps.map(i=>roles[i].name+'交付并确认').join('、'):'立即开始'}`,
      `交付物：${role.out}`, `工作要求：${role.desc}`,
      role.gate?'此分工完成后等待老板确认，后续员工再开始。':'', ''
    ])].join('\n');
}
