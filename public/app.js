// Starts the studio: asks the company backend which models there are, builds the office, then mounts the workspace around it.
import { createOffice } from './office/stage.js';
import { mountWorkspace } from './workspace.js';

const boot = document.getElementById('boot');
// the notice only appears if starting takes a moment, so a normal start shows no flash of it
const slow = setTimeout(() => { boot.hidden = false; }, 400);

async function start() {
  const models = await fetch('/api/models', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`服务返回 ${r.status}`); return r.json(); });
  const office = createOffice({ models });
  await mountWorkspace({ office, models });
  clearTimeout(slow); boot.remove();
}
start().catch(error => {
  clearTimeout(slow); boot.hidden = false;
  // this page is only the window; the work, files and records live in the local server
  boot.innerHTML = `<h1>AI 工作室</h1><p>连不上公司后端，所以这里没有东西可以显示。</p><p>在项目目录运行下面的命令，然后重试：</p><code>node server.js</code><p class="detail"></p><button class="btn primary" type="button">重试</button>`;
  boot.querySelector('.detail').textContent = String(error?.message || error);
  boot.querySelector('button').onclick = () => location.reload();
});
