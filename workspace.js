'use strict';

function createPreviewApi() {
  const previewState = {
    projects: [
      { id: 'preview-saoirse', name: 'Saoirse', path: 'C:\\Projects\\Saoirse', lastOpenedAt: Date.now() },
      { id: 'preview-notes', name: 'ocean-notes', path: 'C:\\Projects\\ocean-notes', lastOpenedAt: Date.now() - 1000 },
    ],
    activeProject: { id: 'preview-saoirse', name: 'Saoirse', path: 'C:\\Projects\\Saoirse', lastOpenedAt: Date.now() },
    backendUrl: null,
    terminalCwd: 'C:\\Projects\\Saoirse',
    permissionMode: 'workspace-write',
    mcpServers: [],
    appearance: { enabled: true, fit: 'cover', position: 'center', overlay: 0.28, blur: 0, zoom: 1, custom: false, label: '鲸灵海底观测站 · 裙装全身版' },
  };
  const rootEntries = [
    { name: 'assets', path: 'assets', kind: 'directory', size: 0 },
    { name: 'bundled-skills', path: 'bundled-skills', kind: 'directory', size: 0 },
    { name: 'main.js', path: 'main.js', kind: 'file', size: 37000 },
    { name: 'package.json', path: 'package.json', kind: 'file', size: 2800 },
    { name: 'README.md', path: 'README.md', kind: 'file', size: 3200 },
    { name: 'workspace.html', path: 'workspace.html', kind: 'file', size: 18000 },
  ];
  return {
    bootstrap: async () => previewState,
    chooseProject: async () => previewState,
    activateProject: async () => previewState,
    removeProject: async () => previewState,
    listDirectory: async (relativePath) => relativePath ? [] : rootEntries,
    openPath: async () => true,
    revealPath: async () => true,
    gitStatus: async () => ({ isRepo: true, branch: 'main', stagedCount: 1, changedCount: 3, entries: [
      { path: 'workspace.js', status: ' M', staged: false, untracked: false },
      { path: 'main.js', status: 'M ', staged: true, untracked: false },
      { path: 'notes/saoirse-plan.md', status: '??', staged: false, untracked: true },
    ] }),
    gitDiff: async (file) => `--- a/${file}\n+++ b/${file}\n@@ -1,3 +1,4 @@\n const saoirse = true;\n+const version = '0.4';`,
    gitHistory: async () => [
      { shortHash: 'a184c9e', author: 'Saoirse', date: new Date().toISOString(), subject: 'feat: build agent control dock' },
      { shortHash: '2bf410a', author: 'Saoirse', date: new Date(Date.now() - 86400000).toISOString(), subject: 'feat: embed DeepSeek Harness' },
    ],
    gitStage: async () => true,
    gitUnstage: async () => true,
    gitCommit: async () => ({ output: '[main a184c9e] preview commit' }),
    gitUndoFile: async () => true,
    createCheckpoint: async () => ({ id: 'preview', label: '界面预览', createdAt: Date.now() }),
    listCheckpoints: async () => [{ id: 'preview', label: '接入技能管理前', createdAt: Date.now() - 3600000, fileCount: 4 }],
    restoreCheckpoint: async () => ({ restored: 4 }),
    validationSuggestions: async () => [{ name: 'test', command: 'npm run test' }, { name: 'build', command: 'npm run build' }],
    listSkills: async () => [
      { id: 'bundled:translation.md', name: 'translation', description: '翻译与本地化文本', source: 'bundled', readonly: true, autoInvoke: true },
      { id: 'user:code-review/SKILL.md', name: 'code-review', description: '审查当前项目变更', source: 'user', readonly: false, autoInvoke: true },
    ],
    readSkill: async (id) => ({ id, readonly: id.startsWith('bundled:'), content: '---\nname: code-review\ndescription: 审查当前项目变更\n---\n\n# Code Review' }),
    saveSkill: async () => [],
    toggleSkill: async () => [],
    deleteSkill: async () => [],
    importSkill: async () => [],
    setPermission: async (mode) => ({ ...previewState, permissionMode: mode }),
    getAppearance: async () => ({ ...previewState.appearance, previewDataUrl: 'assets/saoirse-girl-observatory-skirt.png' }),
    chooseBackground: async () => ({ ...previewState.appearance, custom: true, label: 'my-saoirse-background.png', previewDataUrl: 'assets/saoirse-girl-observatory-skirt.png' }),
    updateAppearance: async (patch) => ({ ...previewState.appearance, ...patch, previewDataUrl: 'assets/saoirse-girl-observatory-skirt.png' }),
    resetAppearance: async () => ({ ...previewState.appearance, previewDataUrl: 'assets/saoirse-girl-observatory-skirt.png' }),
    saveMcp: async () => previewState,
    toggleMcp: async () => previewState,
    deleteMcp: async () => previewState,
    runCommand: async () => ({ started: false, cwd: previewState.terminalCwd }),
    stopCommand: async () => true,
    resetTerminalCwd: async () => previewState.terminalCwd,
    onWorkspaceChanged: () => () => {},
    onBackendState: () => () => {},
    onTerminalData: () => () => {},
    onTerminalState: () => () => {},
    onTerminalCwd: () => () => {},
    onAppearanceChanged: () => () => {},
  };
}

const api = window.saoirseWorkspace || createPreviewApi();

const elements = {
  projectList: document.getElementById('projectList'),
  fileTree: document.getElementById('fileTree'),
  activeProjectName: document.getElementById('activeProjectName'),
  activeProjectPath: document.getElementById('activeProjectPath'),
  backendState: document.getElementById('backendState'),
  companionStatus: document.getElementById('companionStatus'),
  harnessView: document.getElementById('harnessView'),
  harnessCover: document.getElementById('harnessCover'),
  coverTitle: document.getElementById('coverTitle'),
  coverDescription: document.getElementById('coverDescription'),
  terminalCwd: document.getElementById('terminalCwd'),
  terminalStatus: document.getElementById('terminalStatus'),
  terminalOutput: document.getElementById('terminalOutput'),
  terminalInput: document.getElementById('terminalInput'),
  runCommand: document.getElementById('runCommand'),
  stopCommand: document.getElementById('stopCommand'),
  toast: document.getElementById('toast'),
  changeList: document.getElementById('changeList'),
  checkpointList: document.getElementById('checkpointList'),
  diffView: document.getElementById('diffView'),
  historyList: document.getElementById('historyList'),
  validationList: document.getElementById('validationList'),
  skillList: document.getElementById('skillList'),
  skillEditor: document.getElementById('skillEditor'),
  skillSlug: document.getElementById('skillSlug'),
  mcpList: document.getElementById('mcpList'),
  appearancePreviewImage: document.getElementById('appearancePreviewImage'),
  appearancePreviewShade: document.getElementById('appearancePreviewShade'),
  appearanceLabel: document.getElementById('appearanceLabel'),
};

let workspaceState = { projects: [], activeProject: null, backendUrl: null, terminalCwd: null };
let terminalRunning = false;
let toastTimer = null;
let commandHistory = [];
let historyIndex = 0;
let attachedHarnessEvents = false;
let gitState = { isRepo: false, branch: '', entries: [], stagedCount: 0, changedCount: 0 };
let selectedChangePath = '';
let checkpoints = [];
let skills = [];
let selectedSkillId = '';
let selectedMcpId = '';
let gitPollTimer = null;
let appearanceState = { enabled: true, fit: 'cover', position: 'center', overlay: 0.28, blur: 0, zoom: 1, previewDataUrl: '' };

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', error);
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3200);
}

function errorMessage(error) {
  const message = error && error.message ? error.message : String(error || '未知错误');
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
}

function setBackendState(status, detail) {
  elements.backendState.className = `backend-state ${status === 'ready' ? 'ready' : status === 'error' ? 'error' : 'loading'}`;
  const label = elements.backendState.querySelector('span');
  if (label) label.textContent = detail || (status === 'ready' ? 'Harness 已连接' : status === 'error' ? 'Harness 连接失败' : '正在切换项目');
  if (status === 'ready') {
    elements.companionStatus.textContent = workspaceState.activeProject ? '已锁定当前项目航线' : '临时航线已就绪';
  } else if (status === 'error') {
    elements.companionStatus.textContent = '后端连接需要检查';
  } else {
    elements.companionStatus.textContent = '正在重新校准航线';
  }
}

function showHarnessCover(title, description) {
  elements.coverTitle.textContent = title;
  elements.coverDescription.textContent = description;
  elements.harnessCover.classList.remove('hidden');
}

function hideHarnessCover() {
  elements.harnessCover.classList.add('hidden');
}

function attachHarnessEvents() {
  if (attachedHarnessEvents) return;
  attachedHarnessEvents = true;
  elements.harnessView.addEventListener('did-start-loading', () => {
    setBackendState('loading', '正在加载 Harness');
    showHarnessCover('正在进入对话主舱', '项目已经准备好，Saoirse 正在加载 DeepSeek Harness。');
  });
  elements.harnessView.addEventListener('did-stop-loading', () => {
    setBackendState('ready');
    hideHarnessCover();
  });
  elements.harnessView.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return;
    setBackendState('error');
    showHarnessCover('Harness 暂时没有响应', '可以点击“刷新对话”重试，或重新选择项目。');
  });
  elements.harnessView.addEventListener('console-message', (event) => {
    if (event.level >= 3) console.warn('[harness]', event.message);
  });
}

function loadHarness(url) {
  if (!url) return;
  attachHarnessEvents();
  let current = '';
  try { current = elements.harnessView.getURL ? elements.harnessView.getURL() : ''; } catch { /* not attached yet */ }
  if (current === url || current.startsWith(`${url}/`)) {
    elements.harnessView.reload();
  } else {
    elements.harnessView.src = url;
  }
}

function renderProjects() {
  elements.projectList.replaceChildren();
  if (!workspaceState.projects.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '还没有项目。点击右上角 ＋ 选择一个代码文件夹。';
    elements.projectList.appendChild(empty);
    return;
  }

  for (const project of workspaceState.projects) {
    const item = document.createElement('div');
    item.className = `project-item${workspaceState.activeProject?.id === project.id ? ' active' : ''}`;

    const button = document.createElement('button');
    button.className = 'project-button';
    button.title = project.path;
    const name = document.createElement('span');
    name.className = 'project-name';
    name.textContent = project.name;
    const projectPath = document.createElement('span');
    projectPath.className = 'project-path';
    projectPath.textContent = project.path;
    button.append(name, projectPath);
    button.addEventListener('click', () => activateProject(project.id));

    const remove = document.createElement('button');
    remove.className = 'remove-project';
    remove.textContent = '×';
    remove.title = '从最近项目中移除';
    remove.setAttribute('aria-label', `移除项目 ${project.name}`);
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!window.confirm(`从 Saoirse 最近项目中移除“${project.name}”？\n不会删除磁盘文件。`)) return;
      try {
        const next = await api.removeProject(project.id);
        if (next) await applyWorkspaceState(next);
      } catch (error) {
        showToast(errorMessage(error), true);
      }
    });

    item.append(button, remove);
    elements.projectList.appendChild(item);
  }
}

function makeTreeRow(entry) {
  const wrapper = document.createElement('div');
  const row = document.createElement('button');
  row.className = `tree-row ${entry.kind === 'directory' ? 'directory' : 'file'}`;
  row.title = entry.kind === 'file' ? `${entry.path}（双击打开，右键在文件夹中显示）` : entry.path;

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = entry.kind === 'directory' ? '›' : entry.kind === 'symlink' ? '↗' : '·';
  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = entry.name;
  row.append(icon, name);
  wrapper.appendChild(row);

  if (entry.kind === 'directory') {
    let expanded = false;
    let loaded = false;
    const children = document.createElement('div');
    children.className = 'tree-children';
    children.hidden = true;
    wrapper.appendChild(children);
    row.addEventListener('click', async () => {
      expanded = !expanded;
      children.hidden = !expanded;
      icon.textContent = expanded ? '⌄' : '›';
      if (!expanded || loaded) return;
      try {
        const entries = await api.listDirectory(entry.path);
        for (const child of entries) children.appendChild(makeTreeRow(child));
        if (!entries.length) {
          const empty = document.createElement('div');
          empty.className = 'empty-tree';
          empty.textContent = '空文件夹';
          children.appendChild(empty);
        }
        loaded = true;
      } catch (error) {
        showToast(errorMessage(error), true);
      }
    });
  } else {
    row.addEventListener('dblclick', async () => {
      try { await api.openPath(entry.path); } catch (error) { showToast(errorMessage(error), true); }
    });
  }

  row.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    try { await api.revealPath(entry.path); } catch (error) { showToast(errorMessage(error), true); }
  });
  return wrapper;
}

async function renderFileTree() {
  elements.fileTree.replaceChildren();
  if (!workspaceState.activeProject) {
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '选择项目后，这里会显示文件树。文件双击打开，右键可在资源管理器中显示。';
    elements.fileTree.appendChild(empty);
    return;
  }
  try {
    const entries = await api.listDirectory('');
    for (const entry of entries) elements.fileTree.appendChild(makeTreeRow(entry));
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-tree';
      empty.textContent = '这个项目文件夹目前是空的。';
      elements.fileTree.appendChild(empty);
    }
  } catch (error) {
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = `无法读取文件树：${errorMessage(error)}`;
    elements.fileTree.appendChild(empty);
  }
}

async function applyWorkspaceState(nextState) {
  if (!nextState) return;
  workspaceState = nextState;
  if (nextState.appearance) appearanceState = { ...appearanceState, ...nextState.appearance };
  const project = workspaceState.activeProject;
  elements.activeProjectName.textContent = project?.name || '临时航线';
  elements.activeProjectPath.textContent = project?.path || '尚未选择项目，Harness 使用临时工作区';
  elements.terminalCwd.textContent = workspaceState.terminalCwd || project?.path || '临时工作区';
  renderProjects();
  await renderFileTree();
  if (workspaceState.backendUrl) loadHarness(workspaceState.backendUrl);
  renderPermissionMode();
  renderMcpServers();
  if (document.body.dataset.dockOpen === 'true') refreshGitState(true);
}

async function chooseProject() {
  try {
    const next = await api.chooseProject();
    if (!next) return;
    await applyWorkspaceState(next);
    showToast(`已进入项目：${next.activeProject?.name || '临时航线'}`);
  } catch (error) {
    showToast(errorMessage(error), true);
    setBackendState('error');
  }
}

async function activateProject(id) {
  if (workspaceState.activeProject?.id === id) return;
  setBackendState('loading', '正在切换项目');
  showHarnessCover('正在切换项目航线', 'Saoirse 会让 Harness 和终端进入新的项目目录。');
  try {
    const next = await api.activateProject(id);
    await applyWorkspaceState(next);
    showToast(`已切换到：${next.activeProject?.name}`);
  } catch (error) {
    showToast(errorMessage(error), true);
    setBackendState('error');
  }
}

function setTerminalOpen(open) {
  document.body.dataset.terminalOpen = String(open);
  localStorage.setItem('saoirse-terminal-open', String(open));
  document.getElementById('toggleTerminal').textContent = open ? '收起终端' : '展开终端';
  if (open) setTimeout(() => elements.terminalInput.focus(), 50);
}

function appendTerminal(text) {
  const cleaned = String(text || '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '\n');
  elements.terminalOutput.textContent += cleaned;
  if (elements.terminalOutput.textContent.length > 240000) {
    elements.terminalOutput.textContent = elements.terminalOutput.textContent.slice(-180000);
  }
  elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
}

async function runCommand() {
  const command = elements.terminalInput.value.trim();
  if (!command || terminalRunning) return;
  commandHistory = commandHistory.filter((item) => item !== command);
  commandHistory.push(command);
  if (commandHistory.length > 80) commandHistory.shift();
  historyIndex = commandHistory.length;
  elements.terminalInput.value = '';
  try {
    const result = await api.runCommand(command);
    if (result?.cwd) elements.terminalCwd.textContent = result.cwd;
  } catch (error) {
    appendTerminal(`\n${errorMessage(error)}\n`);
    showToast(errorMessage(error), true);
  }
}

function setDockOpen(open, panel = '') {
  document.body.dataset.dockOpen = String(open);
  localStorage.setItem('saoirse-dock-open', String(open));
  if (panel) selectDockPanel(panel);
}

function selectDockPanel(panel) {
  document.querySelectorAll('.dock-tab').forEach((button) => button.classList.toggle('active', button.dataset.panel === panel));
  document.querySelectorAll('.dock-panel').forEach((item) => item.classList.toggle('active', item.dataset.panelBody === panel));
  if (panel === 'changes') refreshChanges();
  if (panel === 'git') refreshGitPanel();
  if (panel === 'skills') refreshSkills();
  if (panel === 'mcp') renderMcpServers();
  if (panel === 'appearance') refreshAppearance();
  if (panel === 'policy') renderPermissionMode();
}

function emptyControl(container, message) {
  container.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty-control';
  empty.textContent = message;
  container.appendChild(empty);
}

function makeControlItem(title, detail, chip = '') {
  const item = document.createElement('div');
  item.className = 'control-item';
  const main = document.createElement('div');
  main.className = 'item-main';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = detail;
  main.append(strong, span);
  item.appendChild(main);
  if (chip) {
    const status = document.createElement('span');
    status.className = 'status-chip';
    status.textContent = chip;
    item.appendChild(status);
  }
  return item;
}

function updateGitMetrics() {
  document.getElementById('changeCount').textContent = String(gitState.changedCount || 0);
  document.getElementById('stagedCount').textContent = String(gitState.stagedCount || 0);
  document.getElementById('gitChanged').textContent = String(gitState.changedCount || 0);
  document.getElementById('gitStaged').textContent = String(gitState.stagedCount || 0);
  const branch = gitState.branch || (gitState.isRepo ? 'HEAD' : '—');
  document.getElementById('branchName').textContent = branch.length > 10 ? `${branch.slice(0, 9)}…` : branch;
  document.getElementById('branchName').title = branch;
}

async function refreshGitState(render = true) {
  if (!workspaceState.activeProject) {
    gitState = { isRepo: false, branch: '', entries: [], stagedCount: 0, changedCount: 0 };
  } else {
    try { gitState = await api.gitStatus(); } catch (error) {
      gitState = { isRepo: false, branch: '', entries: [], stagedCount: 0, changedCount: 0, error: errorMessage(error) };
    }
  }
  updateGitMetrics();
  if (render) renderChanges();
  return gitState;
}

function renderChanges() {
  elements.changeList.replaceChildren();
  if (!gitState.isRepo) {
    emptyControl(elements.changeList, gitState.error || '当前项目还不是 Git 仓库。可在终端运行 git init。');
    elements.diffView.textContent = 'Git 工作区就绪后可查看 Diff。';
    return;
  }
  if (!gitState.entries.length) {
    emptyControl(elements.changeList, '工作区干净，没有待处理变更。');
    elements.diffView.textContent = '没有差异。';
    return;
  }
  for (const entry of gitState.entries) {
    const item = makeControlItem(entry.path, entry.staged ? '已暂存，可提交' : entry.untracked ? '未跟踪文件' : '工作区变更', entry.status);
    item.classList.toggle('selected', selectedChangePath === entry.path);
    item.tabIndex = 0;
    item.addEventListener('click', async () => {
      selectedChangePath = entry.path;
      renderChanges();
      elements.diffView.textContent = '正在读取差异…';
      try { elements.diffView.textContent = await api.gitDiff(entry.path, entry.staged); }
      catch (error) { elements.diffView.textContent = errorMessage(error); }
    });
    elements.changeList.appendChild(item);
  }
}

function renderCheckpoints() {
  document.getElementById('checkpointCount').textContent = String(checkpoints.length);
  elements.checkpointList.replaceChildren();
  if (!checkpoints.length) {
    emptyControl(elements.checkpointList, '还没有检查点。重要改动前先保存一份本地快照。');
    return;
  }
  for (const checkpoint of checkpoints) {
    const date = new Date(checkpoint.createdAt).toLocaleString('zh-CN', { hour12: false });
    const item = makeControlItem(checkpoint.label, `${date} · ${checkpoint.fileCount} 个文件`);
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    const restore = document.createElement('button');
    restore.className = 'mini-button';
    restore.textContent = '恢复';
    restore.addEventListener('click', async () => {
      if (!window.confirm(`恢复检查点“${checkpoint.label}”？\n当前对应文件会被覆盖。`)) return;
      try {
        const result = await api.restoreCheckpoint(checkpoint.id);
        showToast(`已恢复 ${result.restored} 个文件`);
        await refreshChanges();
      } catch (error) { showToast(errorMessage(error), true); }
    });
    actions.appendChild(restore);
    item.appendChild(actions);
    elements.checkpointList.appendChild(item);
  }
}

async function refreshChanges() {
  await refreshGitState(true);
  try { checkpoints = workspaceState.activeProject ? await api.listCheckpoints() : []; }
  catch { checkpoints = []; }
  renderCheckpoints();
}

async function refreshGitPanel() {
  await refreshGitState(false);
  const history = gitState.isRepo ? await api.gitHistory().catch(() => []) : [];
  elements.historyList.replaceChildren();
  if (!history.length) emptyControl(elements.historyList, gitState.isRepo ? '还没有提交记录。' : '当前项目不是 Git 仓库。');
  for (const commit of history) {
    const date = commit.date ? new Date(commit.date).toLocaleDateString('zh-CN') : '';
    elements.historyList.appendChild(makeControlItem(commit.subject, `${commit.shortHash} · ${commit.author} · ${date}`, commit.shortHash));
  }
  const suggestions = await api.validationSuggestions().catch(() => []);
  elements.validationList.replaceChildren();
  if (!suggestions.length) emptyControl(elements.validationList, '未在 package.json 中发现常用验证脚本。');
  for (const suggestion of suggestions) {
    const item = makeControlItem(suggestion.command, '点击后在集成终端中运行');
    const run = document.createElement('button');
    run.className = 'mini-button';
    run.textContent = '运行';
    run.addEventListener('click', async () => {
      setTerminalOpen(true);
      try { await api.runCommand(suggestion.command); showToast(`正在运行 ${suggestion.name}`); }
      catch (error) { showToast(errorMessage(error), true); }
    });
    item.appendChild(run);
    elements.validationList.appendChild(item);
  }
}

function renderSkillList() {
  elements.skillList.replaceChildren();
  if (!skills.length) {
    emptyControl(elements.skillList, '还没有发现技能。');
    return;
  }
  for (const skill of skills) {
    const source = skill.source === 'bundled' ? '内置 · 只读' : skill.autoInvoke ? '个人 · 自动调用' : '个人 · 仅手动调用';
    const item = makeControlItem(skill.name, `${source} · ${skill.description}`, skill.source === 'bundled' ? '内置' : '个人');
    item.classList.toggle('selected', selectedSkillId === skill.id);
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    if (!skill.readonly) {
      const toggle = document.createElement('button');
      toggle.className = 'mini-button';
      toggle.textContent = skill.autoInvoke ? '自动 ✓' : '手动';
      toggle.title = '控制模型是否可以自动选择该技能';
      toggle.addEventListener('click', async (event) => {
        event.stopPropagation();
        try { skills = await api.toggleSkill(skill.id, !skill.autoInvoke); renderSkillList(); showToast('技能调用策略已更新'); }
        catch (error) { showToast(errorMessage(error), true); }
      });
      actions.appendChild(toggle);
    }
    item.appendChild(actions);
    item.addEventListener('click', async () => {
      try {
        const detail = await api.readSkill(skill.id);
        selectedSkillId = skill.id;
        elements.skillEditor.value = detail.content;
        elements.skillEditor.readOnly = detail.readonly;
        elements.skillSlug.value = '';
        elements.skillSlug.disabled = true;
        renderSkillList();
      } catch (error) { showToast(errorMessage(error), true); }
    });
    elements.skillList.appendChild(item);
  }
}

async function refreshSkills() {
  try { skills = await api.listSkills(); renderSkillList(); }
  catch (error) { emptyControl(elements.skillList, errorMessage(error)); }
}

function beginNewSkill() {
  selectedSkillId = '';
  elements.skillSlug.disabled = false;
  elements.skillSlug.value = '';
  elements.skillEditor.readOnly = false;
  elements.skillEditor.value = '---\nname: my-skill\ndescription: 说明这个技能适合在什么任务中使用\ndisable-model-invocation: false\n---\n\n# 工作方式\n\n在这里写清楚步骤、边界和输出要求。\n';
  renderSkillList();
  elements.skillSlug.focus();
}

function parseMappingLines(text, withPrefix = false) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const equals = line.indexOf('=');
    if (equals < 1) throw new Error(`映射格式错误：${line}`);
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1);
    if (!withPrefix) return { key, envVar: value.trim() };
    const separator = value.indexOf('|');
    return separator < 0
      ? { key, envVar: value.trim(), prefix: '' }
      : { key, envVar: value.slice(0, separator).trim(), prefix: value.slice(separator + 1) };
  });
}

function resetMcpForm() {
  selectedMcpId = '';
  document.getElementById('mcpFormTitle').textContent = '添加 MCP 服务器';
  for (const id of ['mcpName', 'mcpCommand', 'mcpArgs', 'mcpEnv', 'mcpUrl', 'mcpHeaders']) document.getElementById(id).value = '';
  document.getElementById('mcpTransport').value = 'stdio';
  updateMcpTransportFields();
  renderMcpServers();
}

function updateMcpTransportFields() {
  const http = document.getElementById('mcpTransport').value === 'streamable-http';
  document.getElementById('mcpStdioFields').hidden = http;
  document.getElementById('mcpHttpFields').hidden = !http;
}

function editMcp(server) {
  selectedMcpId = server.id;
  document.getElementById('mcpFormTitle').textContent = `编辑 MCP · ${server.serverName}`;
  document.getElementById('mcpName').value = server.serverName;
  document.getElementById('mcpTransport').value = server.transport;
  document.getElementById('mcpCommand').value = server.command || '';
  document.getElementById('mcpArgs').value = (server.args || []).join('\n');
  document.getElementById('mcpEnv').value = (server.env || []).map((item) => `${item.key}=${item.envVar}`).join('\n');
  document.getElementById('mcpUrl').value = server.url || '';
  document.getElementById('mcpHeaders').value = (server.headers || []).map((item) => `${item.key}=${item.envVar}${item.prefix ? `|${item.prefix}` : ''}`).join('\n');
  updateMcpTransportFields();
  renderMcpServers();
}

function renderMcpServers() {
  elements.mcpList.replaceChildren();
  const servers = workspaceState.mcpServers || [];
  if (!servers.length) {
    emptyControl(elements.mcpList, '尚未配置 MCP。可先添加一个可信的本地或 HTTPS 服务器。');
    return;
  }
  for (const server of servers) {
    const detail = server.transport === 'stdio' ? `${server.command} ${(server.args || []).join(' ')}` : server.url;
    const item = makeControlItem(server.serverName, `${server.transport} · ${detail}`, server.enabled ? '启用' : '停用');
    item.classList.toggle('selected', selectedMcpId === server.id);
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    const toggle = document.createElement('button');
    toggle.className = 'mini-button';
    toggle.textContent = server.enabled ? '停用' : '启用';
    toggle.addEventListener('click', async (event) => {
      event.stopPropagation();
      try { await applyWorkspaceState(await api.toggleMcp(server.id, !server.enabled)); showToast('MCP 状态已更新'); }
      catch (error) { showToast(errorMessage(error), true); }
    });
    const remove = document.createElement('button');
    remove.className = 'mini-button danger';
    remove.textContent = '删除';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!window.confirm(`删除 MCP“${server.serverName}”？`)) return;
      try { await applyWorkspaceState(await api.deleteMcp(server.id)); resetMcpForm(); showToast('MCP 已删除'); }
      catch (error) { showToast(errorMessage(error), true); }
    });
    actions.append(toggle, remove);
    item.appendChild(actions);
    item.addEventListener('click', () => editMcp(server));
    elements.mcpList.appendChild(item);
  }
}

function renderPermissionMode() {
  document.querySelectorAll('.permission-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.mode === workspaceState.permissionMode);
  });
}

async function saveMcpForm() {
  const transport = document.getElementById('mcpTransport').value;
  const payload = {
    id: selectedMcpId,
    serverName: document.getElementById('mcpName').value.trim(),
    transport,
    enabled: true,
    command: document.getElementById('mcpCommand').value.trim(),
    args: document.getElementById('mcpArgs').value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    env: parseMappingLines(document.getElementById('mcpEnv').value),
    url: document.getElementById('mcpUrl').value.trim(),
    headers: parseMappingLines(document.getElementById('mcpHeaders').value, true),
  };
  const next = await api.saveMcp(payload);
  await applyWorkspaceState(next);
  resetMcpForm();
  showToast('MCP 已保存，Harness 已重新连接');
}

function appearanceFromControls() {
  return {
    enabled: document.getElementById('appearanceEnabled').checked,
    fit: document.getElementById('appearanceFit').value,
    position: document.getElementById('appearancePosition').value,
    overlay: Number(document.getElementById('appearanceOverlay').value) / 100,
    blur: Number(document.getElementById('appearanceBlur').value),
    zoom: Number(document.getElementById('appearanceZoom').value),
  };
}

function renderAppearancePreview() {
  const live = { ...appearanceState, ...appearanceFromControls() };
  elements.appearancePreviewImage.style.backgroundImage = live.enabled && live.previewDataUrl
    ? `url("${live.previewDataUrl}")`
    : 'none';
  elements.appearancePreviewImage.style.backgroundSize = live.fit;
  elements.appearancePreviewImage.style.backgroundPosition = live.position;
  elements.appearancePreviewImage.style.filter = `blur(${live.blur}px)`;
  elements.appearancePreviewShade.style.background = `rgba(3, 13, 29, ${live.overlay})`;
  elements.appearanceLabel.textContent = live.label || '鲸灵海底观测站 · 裙装全身版';
  document.getElementById('appearanceOverlayValue').textContent = `${Math.round(live.overlay * 100)}%`;
  document.getElementById('appearanceBlurValue').textContent = `${live.blur}px`;
}

function populateAppearanceControls() {
  document.getElementById('appearanceEnabled').checked = appearanceState.enabled !== false;
  document.getElementById('appearanceFit').value = appearanceState.fit || 'cover';
  document.getElementById('appearancePosition').value = appearanceState.position || 'center';
  document.getElementById('appearanceOverlay').value = String(Math.round(Number(appearanceState.overlay ?? .28) * 100));
  document.getElementById('appearanceBlur').value = String(Number(appearanceState.blur || 0));
  document.getElementById('appearanceZoom').value = String(Number(appearanceState.zoom || 1));
  renderAppearancePreview();
}

async function refreshAppearance() {
  try {
    appearanceState = await api.getAppearance();
    populateAppearanceControls();
  } catch (error) { showToast(errorMessage(error), true); }
}

async function chooseAppearanceBackground() {
  try {
    const next = await api.chooseBackground();
    if (!next) return;
    appearanceState = next;
    populateAppearanceControls();
    showToast('自定义背景已应用');
  } catch (error) { showToast(errorMessage(error), true); }
}

async function saveAppearance() {
  try {
    appearanceState = await api.updateAppearance(appearanceFromControls());
    populateAppearanceControls();
    showToast('外观已应用，文字缩放已重新校准');
  } catch (error) { showToast(errorMessage(error), true); }
}

document.getElementById('chooseProject').addEventListener('click', chooseProject);
document.getElementById('topChooseProject').addEventListener('click', chooseProject);
document.getElementById('coverChooseProject').addEventListener('click', chooseProject);
document.getElementById('openAppearance').addEventListener('click', () => setDockOpen(true, 'appearance'));
document.getElementById('openControls').addEventListener('click', () => setDockOpen(document.body.dataset.dockOpen !== 'true'));
document.getElementById('closeControls').addEventListener('click', () => setDockOpen(false));
document.querySelectorAll('.dock-tab').forEach((button) => button.addEventListener('click', () => selectDockPanel(button.dataset.panel)));
document.getElementById('refreshChanges').addEventListener('click', refreshChanges);
document.getElementById('createCheckpoint').addEventListener('click', async () => {
  const label = window.prompt('检查点名称', `手动检查点 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  if (!label) return;
  try { await api.createCheckpoint(label); showToast('本地检查点已创建'); await refreshChanges(); }
  catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('stageSelected').addEventListener('click', async () => {
  if (!selectedChangePath) return showToast('请先选择变更文件', true);
  try { await api.gitStage([selectedChangePath]); showToast('文件已暂存'); await refreshChanges(); }
  catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('unstageSelected').addEventListener('click', async () => {
  if (!selectedChangePath) return showToast('请先选择变更文件', true);
  try { await api.gitUnstage([selectedChangePath]); showToast('已取消暂存'); await refreshChanges(); }
  catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('undoSelected').addEventListener('click', async () => {
  if (!selectedChangePath) return showToast('请先选择变更文件', true);
  if (!window.confirm(`撤销“${selectedChangePath}”的当前变更？\nSaoirse 会先自动创建恢复检查点。`)) return;
  try { await api.gitUndoFile(selectedChangePath); showToast('文件已撤销，备份保存在检查点中'); selectedChangePath = ''; await refreshChanges(); }
  catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('refreshGit').addEventListener('click', refreshGitPanel);
document.getElementById('commitChanges').addEventListener('click', async () => {
  const message = document.getElementById('commitMessage').value.trim();
  if (!message) return showToast('请输入提交说明', true);
  if (!window.confirm(`提交 ${gitState.stagedCount} 个已暂存文件？\n\n${message}`)) return;
  try {
    const result = await api.gitCommit(message);
    document.getElementById('commitMessage').value = '';
    showToast(result.output || '提交完成');
    await refreshGitPanel();
  } catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('refreshSkills').addEventListener('click', refreshSkills);
document.getElementById('newSkill').addEventListener('click', beginNewSkill);
document.getElementById('importSkill').addEventListener('click', async () => {
  try { const result = await api.importSkill(); if (result) { skills = result; renderSkillList(); showToast('技能已导入'); } }
  catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('saveSkill').addEventListener('click', async () => {
  if (elements.skillEditor.readOnly) return showToast('内置技能是只读的；可新建个人技能进行改写', true);
  try {
    skills = await api.saveSkill({ id: selectedSkillId, slug: elements.skillSlug.value.trim(), content: elements.skillEditor.value });
    renderSkillList();
    showToast('技能已保存，Harness 已重新加载');
  } catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('deleteSkill').addEventListener('click', async () => {
  if (!selectedSkillId || selectedSkillId.startsWith('bundled:')) return showToast('请选择一个个人技能', true);
  if (!window.confirm('将这个技能移到 Saoirse 回收区？')) return;
  try { skills = await api.deleteSkill(selectedSkillId); selectedSkillId = ''; beginNewSkill(); renderSkillList(); showToast('技能已移到回收区'); }
  catch (error) { showToast(errorMessage(error), true); }
});
document.getElementById('mcpTransport').addEventListener('change', updateMcpTransportFields);
document.getElementById('resetMcpForm').addEventListener('click', resetMcpForm);
document.getElementById('saveMcp').addEventListener('click', () => saveMcpForm().catch((error) => showToast(errorMessage(error), true)));
document.getElementById('chooseBackground').addEventListener('click', chooseAppearanceBackground);
document.getElementById('saveAppearance').addEventListener('click', saveAppearance);
document.getElementById('resetAppearance').addEventListener('click', async () => {
  if (!window.confirm('恢复 Saoirse 默认裙装全身鲸娘背景和推荐显示参数？')) return;
  try {
    appearanceState = await api.resetAppearance();
    populateAppearanceControls();
    showToast('已恢复默认全身背景');
  } catch (error) { showToast(errorMessage(error), true); }
});
for (const id of ['appearanceEnabled', 'appearanceFit', 'appearancePosition', 'appearanceOverlay', 'appearanceBlur', 'appearanceZoom']) {
  document.getElementById(id).addEventListener('input', renderAppearancePreview);
  document.getElementById(id).addEventListener('change', renderAppearancePreview);
}
document.querySelectorAll('.permission-card').forEach((card) => card.addEventListener('click', async () => {
  const mode = card.dataset.mode;
  if (mode === workspaceState.permissionMode) return;
  if (mode === 'danger-full-access' && !window.confirm('完全访问会关闭默认审批并允许项目外写入。\n仅在你完全信任当前任务时继续。')) return;
  try { await applyWorkspaceState(await api.setPermission(mode)); showToast('默认权限已更新，Harness 已重新连接'); }
  catch (error) { showToast(errorMessage(error), true); }
}));
document.getElementById('refreshFiles').addEventListener('click', renderFileTree);
document.getElementById('reloadHarness').addEventListener('click', () => {
  if (workspaceState.backendUrl) loadHarness(workspaceState.backendUrl);
});
document.getElementById('toggleTerminal').addEventListener('click', () => {
  setTerminalOpen(document.body.dataset.terminalOpen !== 'true');
});
document.getElementById('terminalHeader').addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  setTerminalOpen(document.body.dataset.terminalOpen !== 'true');
});
document.getElementById('clearTerminal').addEventListener('click', () => {
  elements.terminalOutput.textContent = '';
});
document.getElementById('resetTerminalCwd').addEventListener('click', async () => {
  try { elements.terminalCwd.textContent = await api.resetTerminalCwd(); } catch (error) { showToast(errorMessage(error), true); }
});
elements.runCommand.addEventListener('click', runCommand);
elements.stopCommand.addEventListener('click', () => api.stopCommand());
elements.terminalInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runCommand();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!commandHistory.length) return;
    historyIndex = Math.max(0, historyIndex - 1);
    elements.terminalInput.value = commandHistory[historyIndex] || '';
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    historyIndex = Math.min(commandHistory.length, historyIndex + 1);
    elements.terminalInput.value = commandHistory[historyIndex] || '';
  } else if (event.key.toLowerCase() === 'c' && event.ctrlKey && terminalRunning) {
    event.preventDefault();
    api.stopCommand();
  } else if (event.key.toLowerCase() === 'l' && event.ctrlKey) {
    event.preventDefault();
    elements.terminalOutput.textContent = '';
  }
});

api.onWorkspaceChanged((next) => applyWorkspaceState(next));
api.onBackendState((state) => {
  if (state?.status === 'ready' && state.backendUrl) {
    workspaceState.backendUrl = state.backendUrl;
    loadHarness(state.backendUrl);
  } else if (state?.status === 'restarting') {
    setBackendState('loading', '正在切换项目');
    showHarnessCover('正在重新连接 Harness', '后端正切换到新的项目工作目录。');
  }
});
api.onTerminalData((payload) => appendTerminal(payload?.text));
api.onTerminalState((payload) => {
  terminalRunning = Boolean(payload?.running);
  elements.terminalStatus.textContent = terminalRunning ? '运行中' : payload?.stopped ? '已停止' : '就绪';
  elements.terminalStatus.classList.toggle('running', terminalRunning);
  elements.runCommand.disabled = terminalRunning;
  elements.terminalInput.disabled = terminalRunning;
  elements.stopCommand.disabled = !terminalRunning;
  if (!terminalRunning) elements.terminalInput.focus();
});
api.onTerminalCwd((payload) => {
  if (payload?.cwd) elements.terminalCwd.textContent = payload.cwd;
});
api.onAppearanceChanged((next) => {
  if (!next) return;
  appearanceState = next;
  populateAppearanceControls();
});

(async () => {
  setTerminalOpen(localStorage.getItem('saoirse-terminal-open') !== 'false');
  const previewPanel = !window.saoirseWorkspace && ['changes', 'git', 'skills', 'mcp', 'appearance', 'policy'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : '';
  setDockOpen(!window.saoirseWorkspace || localStorage.getItem('saoirse-dock-open') === 'true', previewPanel);
  beginNewSkill();
  updateMcpTransportFields();
  populateAppearanceControls();
  try {
    const initial = await api.bootstrap();
    await applyWorkspaceState(initial);
    await refreshChanges();
    gitPollTimer = setInterval(() => {
      if (workspaceState.activeProject) refreshGitState(document.querySelector('[data-panel-body="changes"]')?.classList.contains('active'));
    }, 4500);
  } catch (error) {
    showToast(errorMessage(error), true);
    setBackendState('error');
  }
})();
