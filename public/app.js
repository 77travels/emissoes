/* 77 Travels — Gestão de Emissões (SPA) */
(() => {
  const root = document.getElementById('root');
  const state = {
    user: null,
    view: 'nova',
    fees: [],            // [{gateway, installments, pct}]
    editingId: null,     // id da emissão em edição
    form: null,          // dados do formulário de emissão
    lastSaved: null,     // última emissão salva (para o preview de WhatsApp)
    months: [],
    filterMonth: '',
    searchQ: '',
  };

  // ── util ──────────────────────────────────────────────────────────────────
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const intBR = (v) => (Number(v) || 0).toLocaleString('pt-BR');
  const dateBR = (iso) => { const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); };

  function toast(msg, isErr = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts,
      body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined),
    });
    let data = null;
    try { data = await res.json(); } catch { /* respostas sem corpo */ }
    if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
    return data;
  }

  function blankForm() {
    return {
      passengers: [], locator: '', airline: '', segments: [], ocr_raw: null,
      program: '', supplier_name: '', supplier_phone: '',
      miles_qty: '', cost_per_thousand: '', taxes: '', amount_charged: '',
      payment_method: 'pix', gateway: 'mercadopago', installments: 1, notes: '',
    };
  }

  function feePct(gateway, installments) {
    const f = state.fees.find((x) => x.gateway === gateway && x.installments === Number(installments));
    return f ? f.pct : 0;
  }

  function computeTotals(f) {
    const miles = Number(f.miles_qty) || 0;
    const per = Number(f.cost_per_thousand) || 0;
    const taxes = Number(f.taxes) || 0;
    const charged = Number(f.amount_charged) || 0;
    const milesCost = (miles / 1000) * per;
    const gross = charged - (milesCost + taxes);
    let pct = 0, feeVal = 0;
    if (f.payment_method === 'cartao') {
      pct = feePct(f.gateway, f.installments);
      feeVal = charged * pct / 100;
    }
    return { miles_cost: milesCost, gross_profit: gross, card_fee_pct: pct, card_fee_value: feeVal, net_profit: gross - feeVal };
  }

  // ── shell ─────────────────────────────────────────────────────────────────
  const NAV = [
    ['nova', '➕', 'Nova emissão'],
    ['lista', '📋', 'Emissões'],
    ['fornecedores', '🤝', 'Fornecedores'],
    ['config', '⚙️', 'Configurações'],
  ];

  function render() {
    if (!state.user) { renderLogin(); return; }
    const navItems = NAV.filter(([v]) => v !== 'config' || true);
    root.innerHTML = `
      <div id="app">
        <aside class="sidebar">
          <div class="brand"><img src="/logo.png" alt="77 Travels"></div>
          <nav>
            ${navItems.map(([v, icon, label]) =>
              `<button data-view="${v}" class="${state.view === v ? 'active' : ''}">${icon} ${label}</button>`).join('')}
          </nav>
          <div class="userbox">
            <div class="name">${esc(state.user.name)}</div>
            <div>${esc(state.user.email)}</div>
            <div class="role">${state.user.role === 'master' ? 'Master' : state.user.role === 'admin' ? 'Administrador' : 'Usuário'}</div>
            <button class="btn outline sm" id="btnLogout">Sair</button>
          </div>
        </aside>
        <main class="main" id="view"></main>
      </div>`;
    $$('.sidebar nav button').forEach((b) => b.onclick = () => { state.view = b.dataset.view; state.lastSaved = null; render(); });
    $('#btnLogout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = null; render(); };

    const view = $('#view');
    if (state.view === 'nova') renderNova(view);
    else if (state.view === 'lista') renderLista(view);
    else if (state.view === 'fornecedores') renderFornecedores(view);
    else if (state.view === 'config') renderConfig(view);
  }

  // ── login ─────────────────────────────────────────────────────────────────
  function renderLogin() {
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <img src="/logo.png" alt="77 Travels">
          <p class="sub">Gestão de Emissões de Passagens</p>
          <form id="loginForm">
            <label class="field">E-mail <input type="email" name="email" required autocomplete="username"></label>
            <label class="field">Senha <input type="password" name="password" required autocomplete="current-password"></label>
            <button class="btn blue" type="submit">Entrar</button>
          </form>
        </div>
      </div>`;
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const data = await api('/api/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
        state.user = data.user;
        await loadFees();
        state.view = 'nova';
        state.form = blankForm();
        render();
      } catch (err) { toast(err.message, true); }
    };
  }

  async function loadFees() {
    try { state.fees = (await api('/api/settings/card-fees')).fees; } catch { state.fees = []; }
  }

  // ── nova emissão ──────────────────────────────────────────────────────────
  function renderNova(view) {
    if (!state.form) state.form = blankForm();
    const f = state.form;
    const editing = state.editingId != null;

    view.innerHTML = `
      <header class="page">
        <h1>${editing ? `Editar emissão #${state.editingId}` : 'Nova emissão'}</h1>
        ${editing ? '<button class="btn outline sm" id="btnCancelEdit">Cancelar edição</button>' : ''}
      </header>

      ${state.lastSaved ? waPreviewHTML(state.lastSaved) : ''}

      <div class="card">
        <h2>1. Voucher / confirmação de compra <span class="tag">OCR</span></h2>
        <div class="dropzone" id="dropzone">
          <div class="big">📄 Arraste o voucher aqui ou clique para escolher</div>
          <div class="small">PDF ou imagem (JPG, PNG, WebP) — os dados são extraídos automaticamente e podem ser corrigidos abaixo</div>
          <input type="file" id="fileInput" accept="application/pdf,image/*" class="hidden">
        </div>
        <div id="ocrStatus" class="mt"></div>
      </div>

      <div class="card">
        <h2>2. Dados do voo <span class="tag">extraídos pelo OCR — edite se necessário</span></h2>
        <div class="grid c2">
          <label class="field">Passageiros <span class="hint">(Enter para adicionar)</span>
            <input id="paxInput" placeholder="NOME DO PASSAGEIRO">
          </label>
          <div>
            <div class="chips mt" id="paxChips"></div>
          </div>
        </div>
        <div class="grid c2 mt">
          <label class="field">Localizador <input id="fLocator" value="${esc(f.locator)}" placeholder="ABC123"></label>
          <label class="field">Companhia aérea <input id="fAirline" value="${esc(f.airline)}" placeholder="LATAM, GOL, Azul..."></label>
        </div>
        <hr class="sep">
        <div class="row" style="justify-content:space-between">
          <strong>Trechos</strong>
          <button class="btn outline sm" id="btnAddSeg">+ Adicionar trecho</button>
        </div>
        <div id="segList" class="mt"></div>
      </div>

      <div class="card">
        <h2>3. Dados da emissão <span class="tag">preenchimento manual</span></h2>
        <div class="grid c3">
          <label class="field">Programa de fidelidade <input id="fProgram" value="${esc(f.program)}" placeholder="Smiles, LATAM Pass, TudoAzul..."></label>
          <label class="field ac-wrap">Fornecedor
            <input id="fSupName" value="${esc(f.supplier_name)}" placeholder="Nome do fornecedor" autocomplete="off">
            <div class="ac-list hidden" id="acName"></div>
          </label>
          <label class="field ac-wrap">Telefone do fornecedor
            <input id="fSupPhone" value="${esc(f.supplier_phone)}" placeholder="(11) 99999-9999" autocomplete="off">
            <div class="ac-list hidden" id="acPhone"></div>
          </label>
        </div>
        <div class="grid c4 mt">
          <label class="field">Quantidade de milhas <input id="fMiles" type="number" min="0" step="1" value="${esc(f.miles_qty)}"></label>
          <label class="field">Custo do milheiro (R$) <input id="fPer" type="number" min="0" step="0.01" value="${esc(f.cost_per_thousand)}"></label>
          <label class="field">Taxas (R$) <input id="fTaxes" type="number" min="0" step="0.01" value="${esc(f.taxes)}"></label>
          <label class="field">Valor cobrado (R$) <input id="fCharged" type="number" min="0" step="0.01" value="${esc(f.amount_charged)}"></label>
        </div>
        <div class="grid c3 mt">
          <label class="field">Forma de pagamento
            <select id="fPay">
              <option value="pix" ${f.payment_method === 'pix' ? 'selected' : ''}>Pix</option>
              <option value="cartao" ${f.payment_method === 'cartao' ? 'selected' : ''}>Cartão de crédito</option>
            </select>
          </label>
          <label class="field ${f.payment_method === 'cartao' ? '' : 'hidden'}" id="wrapGateway">Link de pagamento
            <select id="fGateway">
              <option value="mercadopago" ${f.gateway === 'mercadopago' ? 'selected' : ''}>Mercado Pago</option>
              <option value="cielo" ${f.gateway === 'cielo' ? 'selected' : ''}>Cielo</option>
            </select>
          </label>
          <label class="field ${f.payment_method === 'cartao' ? '' : 'hidden'}" id="wrapInst">Parcelas
            <select id="fInst">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${Number(f.installments) === i + 1 ? 'selected' : ''}>${i + 1}x</option>`).join('')}</select>
          </label>
        </div>
        <label class="field mt">Observações <textarea id="fNotes" placeholder="Anotações internas (opcional)">${esc(f.notes)}</textarea></label>
      </div>

      <div class="card">
        <h2>4. Cálculo <span class="tag">automático</span></h2>
        <div class="totals" id="totals"></div>
        <div class="row mt">
          <button class="btn green" id="btnSave">💾 ${editing ? 'Salvar alterações' : 'Salvar emissão'} e gerar mensagem</button>
        </div>
      </div>`;

    // passageiros (chips)
    const renderPax = () => {
      $('#paxChips').innerHTML = f.passengers.map((p, i) =>
        `<span class="chip">${esc(p)} <button data-i="${i}" title="Remover">×</button></span>`).join('') || '<span class="muted">Nenhum passageiro</span>';
      $$('#paxChips button').forEach((b) => b.onclick = () => { f.passengers.splice(Number(b.dataset.i), 1); renderPax(); });
    };
    renderPax();
    $('#paxInput').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = e.target.value.trim().toUpperCase();
        if (v) { f.passengers.push(v); e.target.value = ''; renderPax(); }
      }
    };

    // trechos
    const renderSegs = () => {
      const list = $('#segList');
      list.innerHTML = f.segments.map((s, i) => `
        <div class="seg-row" data-i="${i}">
          <label class="field">Sentido
            <select data-k="direction">
              <option value="ida" ${s.direction !== 'volta' ? 'selected' : ''}>Ida</option>
              <option value="volta" ${s.direction === 'volta' ? 'selected' : ''}>Volta</option>
            </select>
          </label>
          <label class="field">Data <input type="date" data-k="date" value="${esc(s.date)}"></label>
          <label class="field">Origem <input data-k="origin" value="${esc(s.origin)}" placeholder="GRU"></label>
          <label class="field">Destino <input data-k="destination" value="${esc(s.destination)}" placeholder="LIS"></label>
          <label class="field">Saída <input type="time" data-k="departure_time" value="${esc(s.departure_time)}"></label>
          <label class="field">Chegada <input type="time" data-k="arrival_time" value="${esc(s.arrival_time)}"></label>
          <label class="field">Voo <input data-k="flight_number" value="${esc(s.flight_number)}" placeholder="LA3340"></label>
          <button class="del" title="Remover trecho">🗑</button>
        </div>`).join('') || '<div class="muted">Nenhum trecho — envie o voucher acima ou adicione manualmente.</div>';
      $$('#segList .seg-row').forEach((row) => {
        const i = Number(row.dataset.i);
        $$('[data-k]', row).forEach((inp) => inp.oninput = () => { f.segments[i][inp.dataset.k] = inp.value; });
        $('.del', row).onclick = () => { f.segments.splice(i, 1); renderSegs(); };
      });
    };
    renderSegs();
    $('#btnAddSeg').onclick = () => {
      f.segments.push({ direction: f.segments.some((s) => s.direction === 'ida') ? 'volta' : 'ida', date: '', origin: '', destination: '', departure_time: '', arrival_time: '', flight_number: '' });
      renderSegs();
    };

    // vínculo campos → estado + totais
    const bind = (id, key) => { $(id).oninput = () => { f[key] = $(id).value; renderTotals(); }; };
    bind('#fLocator', 'locator'); bind('#fAirline', 'airline'); bind('#fProgram', 'program');
    bind('#fMiles', 'miles_qty'); bind('#fPer', 'cost_per_thousand'); bind('#fTaxes', 'taxes'); bind('#fCharged', 'amount_charged');
    bind('#fNotes', 'notes');
    $('#fPay').onchange = () => {
      f.payment_method = $('#fPay').value;
      $('#wrapGateway').classList.toggle('hidden', f.payment_method !== 'cartao');
      $('#wrapInst').classList.toggle('hidden', f.payment_method !== 'cartao');
      renderTotals();
    };
    $('#fGateway').onchange = () => { f.gateway = $('#fGateway').value; renderTotals(); };
    $('#fInst').onchange = () => { f.installments = Number($('#fInst').value); renderTotals(); };

    const renderTotals = () => {
      const t = computeTotals(f);
      $('#totals').innerHTML = `
        <div class="total-box"><div class="lbl">Custo das milhas</div><div class="val">${brl(t.miles_cost)}</div></div>
        <div class="total-box ${t.gross_profit >= 0 ? 'good' : 'bad'}"><div class="lbl">Lucro bruto</div><div class="val">${brl(t.gross_profit)}</div></div>
        <div class="total-box"><div class="lbl">Taxa do cartão ${f.payment_method === 'cartao' ? `(${t.card_fee_pct.toLocaleString('pt-BR')}%)` : ''}</div><div class="val">${brl(t.card_fee_value)}</div></div>
        <div class="total-box ${t.net_profit >= 0 ? 'good' : 'bad'}"><div class="lbl">Lucro líquido</div><div class="val">${brl(t.net_profit)}</div></div>`;
    };
    renderTotals();

    // autocomplete de fornecedor (nome e telefone)
    setupSupplierAC('#fSupName', '#acName', f);
    setupSupplierAC('#fSupPhone', '#acPhone', f);

    // OCR upload
    const dz = $('#dropzone');
    const fi = $('#fileInput');
    dz.onclick = () => fi.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) doOCR(e.dataTransfer.files[0]); };
    fi.onchange = () => { if (fi.files[0]) doOCR(fi.files[0]); };

    async function doOCR(file) {
      $('#ocrStatus').innerHTML = '<span class="spinner"></span> Lendo o voucher e extraindo os dados…';
      try {
        const fd = new FormData();
        fd.append('file', file);
        const data = await api('/api/ocr', { method: 'POST', body: fd });
        f.passengers = data.passengers || [];
        f.locator = data.locator || '';
        f.airline = data.airline || '';
        f.segments = (data.segments || []).map((s) => ({
          direction: s.direction === 'volta' ? 'volta' : 'ida',
          date: s.date || '', origin: s.origin || '', destination: s.destination || '',
          departure_time: s.departure_time || '', arrival_time: s.arrival_time || '',
          flight_number: s.flight_number || '',
        }));
        f.ocr_raw = data.raw_text || null;
        toast(data.engine === 'claude' ? 'Dados extraídos com IA — confira os campos.' : 'Dados extraídos por OCR local — confira os campos com atenção.');
        render(); // redesenha com os campos preenchidos
      } catch (err) {
        $('#ocrStatus').innerHTML = '';
        toast(err.message, true);
      }
    }

    // salvar
    $('#btnSave').onclick = async () => {
      const btn = $('#btnSave');
      btn.disabled = true;
      try {
        const payload = { ...f };
        const data = state.editingId
          ? await api(`/api/emissions/${state.editingId}`, { method: 'PUT', body: payload })
          : await api('/api/emissions', { method: 'POST', body: payload });
        state.lastSaved = data.emission;
        state.form = blankForm();
        state.editingId = null;
        toast('Emissão salva! Mensagem do WhatsApp pronta abaixo.');
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        toast(err.message, true);
      } finally { btn.disabled = false; }
    };

    if (editing) {
      $('#btnCancelEdit').onclick = () => { state.editingId = null; state.form = blankForm(); render(); };
    }
  }

  function waPreviewHTML(e) {
    return `
      <div class="card" id="waCard">
        <h2>✅ Emissão #${e.id} salva — mensagem para o grupo de emissões</h2>
        <div class="wa-preview">${esc(e.whatsapp_message)}</div>
        <div class="row mt">
          <button class="btn green" id="btnWaOpen">📱 Abrir no WhatsApp</button>
          <button class="btn outline" id="btnWaCopy">📋 Copiar mensagem</button>
          <button class="btn outline" id="btnWaClose">Fechar</button>
        </div>
      </div>`;
  }
  // delegação p/ botões do preview (renderizados em mais de uma tela)
  document.addEventListener('click', (ev) => {
    if (ev.target.id === 'btnWaOpen' && state.lastSaved) window.open(state.lastSaved.whatsapp_group_link, '_blank');
    if (ev.target.id === 'btnWaCopy' && state.lastSaved) {
      navigator.clipboard.writeText(state.lastSaved.whatsapp_message).then(() => toast('Mensagem copiada!'));
    }
    if (ev.target.id === 'btnWaClose') { state.lastSaved = null; render(); }
  });

  function setupSupplierAC(inputSel, listSel, f) {
    const input = $(inputSel);
    const list = $(listSel);
    let timer = null;
    input.oninput = () => {
      f[inputSel === '#fSupName' ? 'supplier_name' : 'supplier_phone'] = input.value;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) { list.classList.add('hidden'); return; }
        try {
          const data = await api('/api/suppliers?q=' + encodeURIComponent(q));
          if (!data.suppliers.length) { list.classList.add('hidden'); return; }
          list.innerHTML = data.suppliers.map((s) =>
            `<div data-name="${esc(s.name)}" data-phone="${esc(s.phone)}"><strong>${esc(s.name)}</strong><div class="ph">${esc(s.phone)}</div></div>`).join('');
          list.classList.remove('hidden');
          $$('div[data-name]', list).forEach((d) => d.onclick = () => {
            f.supplier_name = d.dataset.name;
            f.supplier_phone = d.dataset.phone;
            $('#fSupName').value = d.dataset.name;
            $('#fSupPhone').value = d.dataset.phone;
            list.classList.add('hidden');
          });
        } catch { /* silencioso */ }
      }, 250);
    };
    input.onblur = () => setTimeout(() => list.classList.add('hidden'), 200);
  }

  // ── lista de emissões ─────────────────────────────────────────────────────
  async function renderLista(view) {
    view.innerHTML = '<header class="page"><h1>Emissões</h1></header><div class="card"><span class="spinner"></span> Carregando…</div>';
    let months = [];
    try { months = (await api('/api/emissions/months')).months; } catch { /* */ }
    state.months = months;

    const qs = new URLSearchParams();
    if (state.filterMonth) qs.set('month', state.filterMonth);
    if (state.searchQ) qs.set('q', state.searchQ);
    let data;
    try { data = await api('/api/emissions?' + qs.toString()); }
    catch (err) { view.innerHTML = `<div class="card">Erro: ${esc(err.message)}</div>`; return; }

    view.innerHTML = `
      <header class="page">
        <h1>Emissões <span class="muted" style="font-size:15px">(${data.count})</span></h1>
        <div class="row">
          <select id="fltMonth">
            <option value="">Todos os meses</option>
            ${months.map((m) => `<option value="${m}" ${state.filterMonth === m ? 'selected' : ''}>${m.split('-')[1]}/${m.split('-')[0]}</option>`).join('')}
          </select>
          <input id="fltQ" placeholder="Buscar localizador, passageiro..." value="${esc(state.searchQ)}" style="width:240px">
        </div>
      </header>

      ${state.lastSaved ? waPreviewHTML(state.lastSaved) : ''}

      <div class="card">
        <div class="totals" style="grid-template-columns:repeat(3,1fr)">
          <div class="total-box"><div class="lbl">Valor cobrado (total)</div><div class="val">${brl(data.totals.amount_charged)}</div></div>
          <div class="total-box good"><div class="lbl">Lucro bruto (total)</div><div class="val">${brl(data.totals.gross_profit)}</div></div>
          <div class="total-box good"><div class="lbl">Lucro líquido (total)</div><div class="val">${brl(data.totals.net_profit)}</div></div>
        </div>
      </div>

      <div class="card table-wrap">
        <table>
          <thead><tr>
            <th>Data</th><th>Passageiro(s)</th><th>Localizador</th><th>Cia / Trechos</th>
            <th>Fornecedor</th><th>Pgto</th>
            <th class="num">Cobrado</th><th class="num">L. bruto</th><th class="num">L. líquido</th>
            <th>Ações</th>
          </tr></thead>
          <tbody>
            ${data.emissions.map((e) => `
              <tr>
                <td>${dateBR(e.created_at)}<div class="sub">#${e.id}</div></td>
                <td>${e.passengers.map(esc).join('<br>') || '—'}</td>
                <td><strong>${esc(e.locator) || '—'}</strong><div class="sub">${esc(e.program)}</div></td>
                <td>${esc(e.airline)}<div class="sub">${e.segments.map((s) => `${esc(s.origin)}→${esc(s.destination)} ${dateBR(s.date)}`).join('<br>')}</div></td>
                <td>${esc(e.supplier_name) || '—'}<div class="sub">${esc(e.supplier_phone)}</div></td>
                <td><span class="badge ${e.payment_method}">${e.payment_method === 'cartao' ? `Cartão ${e.installments}x` : 'Pix'}</span>
                  ${e.payment_method === 'cartao' ? `<div class="sub">${e.gateway === 'mercadopago' ? 'Mercado Pago' : 'Cielo'}</div>` : ''}</td>
                <td class="num">${brl(e.amount_charged)}</td>
                <td class="num">${brl(e.gross_profit)}</td>
                <td class="num"><strong>${brl(e.net_profit)}</strong></td>
                <td>
                  <div class="actions">
                    <button class="btn sm green" data-act="wa" data-id="${e.id}" title="Mensagem para o grupo de emissões">💬 WhatsApp</button>
                    <button class="btn sm blue" data-act="alt" data-id="${e.id}" title="Enviar 'preciso resolver uma alteração' ao fornecedor">🔁 Alterações</button>
                    <button class="btn sm outline" data-act="edit" data-id="${e.id}">✏️ Editar</button>
                    <button class="btn sm danger" data-act="del" data-id="${e.id}">Excluir</button>
                  </div>
                </td>
              </tr>`).join('') || '<tr><td colspan="10" class="muted">Nenhuma emissão encontrada.</td></tr>'}
          </tbody>
        </table>
      </div>`;

    $('#fltMonth').onchange = () => { state.filterMonth = $('#fltMonth').value; renderLista(view); };
    let qTimer;
    $('#fltQ').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.searchQ = $('#fltQ').value; renderLista(view); }, 350); };

    const byId = Object.fromEntries(data.emissions.map((e) => [String(e.id), e]));
    $$('button[data-act]').forEach((b) => b.onclick = async () => {
      const e = byId[b.dataset.id];
      const act = b.dataset.act;
      if (act === 'wa') {
        state.lastSaved = e;
        renderLista(view);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (act === 'alt') {
        if (!e.supplier_phone) return toast('Esta emissão não tem telefone de fornecedor cadastrado.', true);
        window.open(e.change_link, '_blank');
      } else if (act === 'edit') {
        state.editingId = e.id;
        state.form = {
          passengers: [...e.passengers], locator: e.locator, airline: e.airline,
          segments: e.segments.map((s) => ({ ...s })), ocr_raw: null,
          program: e.program, supplier_name: e.supplier_name, supplier_phone: e.supplier_phone,
          miles_qty: e.miles_qty, cost_per_thousand: e.cost_per_thousand, taxes: e.taxes,
          amount_charged: e.amount_charged, payment_method: e.payment_method,
          gateway: e.gateway || 'mercadopago', installments: e.installments, notes: e.notes,
        };
        state.view = 'nova';
        state.lastSaved = null;
        render();
      } else if (act === 'del') {
        if (!confirm(`Excluir a emissão #${e.id} (${e.locator})? A linha da planilha do Drive não é removida automaticamente.`)) return;
        try { await api(`/api/emissions/${e.id}`, { method: 'DELETE' }); toast('Emissão excluída.'); renderLista(view); }
        catch (err) { toast(err.message, true); }
      }
    });
  }

  // ── fornecedores ──────────────────────────────────────────────────────────
  async function renderFornecedores(view) {
    view.innerHTML = '<header class="page"><h1>Fornecedores</h1></header><div class="card"><span class="spinner"></span></div>';
    let data;
    try { data = await api('/api/suppliers'); }
    catch (err) { view.innerHTML = `<div class="card">Erro: ${esc(err.message)}</div>`; return; }
    view.innerHTML = `
      <header class="page"><h1>Fornecedores</h1></header>
      <div class="card">
        <p class="muted">Fornecedores são cadastrados automaticamente ao salvar emissões e alimentam o preenchimento automático do formulário.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Telefone</th><th class="num">Emissões</th><th></th></tr></thead>
            <tbody>
              ${data.suppliers.map((s) => `
                <tr>
                  <td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td class="num">${s.uses}</td>
                  <td class="right"><button class="btn sm danger" data-id="${s.id}">Excluir</button></td>
                </tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum fornecedor ainda.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
    $$('button[data-id]', view).forEach((b) => b.onclick = async () => {
      if (!confirm('Excluir este fornecedor da lista de sugestões?')) return;
      await api('/api/suppliers/' + b.dataset.id, { method: 'DELETE' });
      renderFornecedores(view);
    });
  }

  // ── configurações ─────────────────────────────────────────────────────────
  async function renderConfig(view) {
    const isAdmin = ['master', 'admin'].includes(state.user.role);
    view.innerHTML = `<header class="page"><h1>Configurações</h1></header><div id="cfgBody"><div class="card"><span class="spinner"></span></div></div>`;
    const body = $('#cfgBody');

    let feesHTML = '';
    if (isAdmin) {
      await loadFees();
      const feeBlock = (gw, label) => `
        <h3>${label}</h3>
        <div class="fee-grid">
          ${Array.from({ length: 12 }, (_, i) => {
            const pct = feePct(gw, i + 1);
            return `<label>${i + 1}x (%)<input type="number" step="0.01" min="0" data-gw="${gw}" data-inst="${i + 1}" value="${pct}"></label>`;
          }).join('')}
        </div>`;
      feesHTML = `
        <div class="card">
          <h2>Taxas do cartão por parcela <span class="tag">usadas no cálculo do lucro líquido</span></h2>
          <p class="muted">Informe o percentual cobrado pelo link de pagamento em cada quantidade de parcelas.</p>
          ${feeBlock('mercadopago', 'Mercado Pago')}
          ${feeBlock('cielo', 'Cielo')}
          <button class="btn mt" id="btnSaveFees">Salvar taxas</button>
        </div>`;
    }

    let driveHTML = '';
    let usersHTML = '';
    let hintsHTML = '';
    if (isAdmin) {
      driveHTML = `
        <div class="card" id="driveCard">
          <h2>Google Drive <span class="tag">planilhas mensais de emissões</span></h2>
          <div id="driveStatus"><span class="spinner"></span></div>
        </div>`;
      hintsHTML = `
        <div class="card">
          <h2>OCR dos vouchers <span class="tag">local e gratuito</span></h2>
          <p class="muted">A leitura é feita com OCR local (sem custo), com parsers calibrados para os modelos da agência: <strong>bilhete 77 Travels (LATAM/GOL)</strong>, <strong>bilhete GOL detalhado</strong>, <strong>comprovante de compra LATAM</strong> e <strong>e-ticket internacional (Amadeus/Qatar)</strong>. Para ensinar um novo modelo, envie uma amostra do arquivo para calibrarmos um novo parser.</p>
          <p class="muted">O campo abaixo só é usado se a leitura com IA estiver ativada no servidor (<code>OCR_ENGINE=claude</code>): são regras extras passadas à IA a cada leitura.</p>
          <textarea id="fHints" rows="4" placeholder="Uma regra por linha… (usado apenas com OCR_ENGINE=claude)"></textarea>
          <button class="btn mt" id="btnSaveHints">Salvar regras</button>
        </div>`;
      usersHTML = `
        <div class="card">
          <h2>Usuários <span class="tag">${state.user.role === 'master' ? 'master define o tipo de cada usuário' : 'administração'}</span></h2>
          <div id="usersList"><span class="spinner"></span></div>
          <hr class="sep">
          <h3>Novo usuário</h3>
          <div class="grid c4">
            <label class="field">Nome <input id="nuName"></label>
            <label class="field">E-mail <input id="nuEmail" type="email"></label>
            <label class="field">Senha <input id="nuPass" type="password"></label>
            <label class="field">Tipo
              <select id="nuRole">
                <option value="user">Usuário comum</option>
                ${state.user.role === 'master' ? '<option value="admin">Administrador</option>' : ''}
              </select>
            </label>
          </div>
          <button class="btn mt" id="btnAddUser">Criar usuário</button>
        </div>`;
    }

    body.innerHTML = `
      ${feesHTML}
      ${driveHTML}
      ${hintsHTML}
      ${usersHTML}
      <div class="card">
        <h2>Minha senha</h2>
        <div class="grid c3">
          <label class="field">Senha atual <input id="pwCur" type="password"></label>
          <label class="field">Nova senha <input id="pwNew" type="password"></label>
          <label class="field">&nbsp;<button class="btn" id="btnPw">Alterar senha</button></label>
        </div>
      </div>`;

    // taxas
    if (isAdmin) {
      $('#btnSaveFees').onclick = async () => {
        const fees = $$('input[data-gw]').map((i) => ({ gateway: i.dataset.gw, installments: Number(i.dataset.inst), pct: Number(i.value) || 0 }));
        try { await api('/api/settings/card-fees', { method: 'PUT', body: { fees } }); await loadFees(); toast('Taxas salvas.'); }
        catch (err) { toast(err.message, true); }
      };

      // dicas do OCR
      try { $('#fHints').value = (await api('/api/settings/extraction-hints')).hints; } catch { /* */ }
      $('#btnSaveHints').onclick = async () => {
        try { await api('/api/settings/extraction-hints', { method: 'PUT', body: { hints: $('#fHints').value } }); toast('Regras salvas — valem para as próximas leituras.'); }
        catch (err) { toast(err.message, true); }
      };

      // drive
      const renderDrive = async () => {
        try {
          const st = await api('/api/drive/status');
          const el = $('#driveStatus');
          if (!st.configured) {
            el.innerHTML = `<p class="muted">⚠️ As credenciais do Google ainda não foram configuradas no servidor. Defina <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> e <code>GOOGLE_REDIRECT_URI</code> no arquivo <code>.env</code> (instruções no README).</p>`;
          } else if (!st.connected) {
            el.innerHTML = `
              <p class="muted">Conecte a conta Google da agência para criar a pasta <strong>Emissões 77 Travels</strong> com planilhas mensais preenchidas automaticamente.</p>
              <button class="btn blue" id="btnDriveConnect">🔗 Conectar Google Drive</button>`;
            $('#btnDriveConnect').onclick = async () => {
              try { const { url } = await api('/api/drive/connect'); window.location.href = url; }
              catch (err) { toast(err.message, true); }
            };
          } else {
            el.innerHTML = `
              <p>✅ Conectado. Cada emissão salva é enviada para a planilha do mês em <strong>Emissões 77 Travels / ano / mês</strong>, com a coluna “Alterações” apontando para o WhatsApp do fornecedor.</p>
              <div class="row">
                <button class="btn outline" id="btnDriveSync">🔄 Reenviar todas as emissões</button>
                <button class="btn danger" id="btnDriveDisc">Desconectar</button>
              </div>`;
            $('#btnDriveSync').onclick = async () => {
              const b = $('#btnDriveSync'); b.disabled = true;
              try { const r = await api('/api/drive/sync', { method: 'POST', body: {} }); toast(`Sincronizadas ${r.ok} de ${r.total} emissões.`); }
              catch (err) { toast(err.message, true); }
              finally { b.disabled = false; }
            };
            $('#btnDriveDisc').onclick = async () => {
              if (!confirm('Desconectar o Google Drive?')) return;
              await api('/api/drive/disconnect', { method: 'POST' });
              renderDrive();
            };
          }
        } catch (err) { $('#driveStatus').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
      };
      renderDrive();

      // usuários
      const renderUsers = async () => {
        try {
          const { users } = await api('/api/users');
          $('#usersList').innerHTML = `
            <div class="table-wrap"><table>
              <thead><tr><th>Nome</th><th>E-mail</th><th>Tipo</th><th>Status</th><th></th></tr></thead>
              <tbody>${users.map((u) => `
                <tr>
                  <td>${esc(u.name)}</td>
                  <td>${esc(u.email)}</td>
                  <td>${u.role === 'master' ? '⭐ Master' : `
                    <select data-role="${u.id}" ${state.user.role !== 'master' ? 'disabled' : ''}>
                      <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuário comum</option>
                      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
                    </select>`}</td>
                  <td>${u.active ? 'Ativo' : '<span style="color:var(--red)">Inativo</span>'}</td>
                  <td class="right">${u.role === 'master' ? '' : `
                    <div class="actions" style="justify-content:flex-end">
                      <button class="btn sm outline" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Desativar' : 'Ativar'}</button>
                      <button class="btn sm danger" data-del="${u.id}">Excluir</button>
                    </div>`}</td>
                </tr>`).join('')}</tbody>
            </table></div>`;
          $$('select[data-role]').forEach((s) => s.onchange = async () => {
            try { await api('/api/users/' + s.dataset.role, { method: 'PATCH', body: { role: s.value } }); toast('Tipo de usuário atualizado.'); }
            catch (err) { toast(err.message, true); renderUsers(); }
          });
          $$('button[data-toggle]').forEach((b) => b.onclick = async () => {
            try { await api('/api/users/' + b.dataset.toggle, { method: 'PATCH', body: { active: b.dataset.active !== '1' } }); renderUsers(); }
            catch (err) { toast(err.message, true); }
          });
          $$('button[data-del]').forEach((b) => b.onclick = async () => {
            if (!confirm('Excluir este usuário?')) return;
            try { await api('/api/users/' + b.dataset.del, { method: 'DELETE' }); renderUsers(); }
            catch (err) { toast(err.message, true); }
          });
        } catch (err) { $('#usersList').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
      };
      renderUsers();

      $('#btnAddUser').onclick = async () => {
        try {
          await api('/api/users', { method: 'POST', body: { name: $('#nuName').value, email: $('#nuEmail').value, password: $('#nuPass').value, role: $('#nuRole').value } });
          $('#nuName').value = $('#nuEmail').value = $('#nuPass').value = '';
          toast('Usuário criado.');
          renderUsers();
        } catch (err) { toast(err.message, true); }
      };
    }

    // senha
    $('#btnPw').onclick = async () => {
      try {
        await api('/api/auth/change-password', { method: 'POST', body: { current_password: $('#pwCur').value, new_password: $('#pwNew').value } });
        $('#pwCur').value = $('#pwNew').value = '';
        toast('Senha alterada.');
      } catch (err) { toast(err.message, true); }
    };
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  (async () => {
    // feedback do retorno do OAuth do Google
    const params = new URLSearchParams(window.location.search);
    const driveResult = params.get('drive');
    if (driveResult) window.history.replaceState({}, '', '/');

    try {
      const { user } = await api('/api/auth/me');
      state.user = user;
      if (user) { await loadFees(); state.form = blankForm(); if (driveResult) state.view = 'config'; }
    } catch { /* */ }
    render();
    if (driveResult === 'ok') toast('Google Drive conectado com sucesso!');
    if (driveResult === 'erro') toast('Falha ao conectar o Google Drive.', true);
  })();
})();
