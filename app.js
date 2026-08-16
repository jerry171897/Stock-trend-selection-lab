(() => {
  const bundle = window.DAILY_RECOMMENDATIONS;
  const grid = document.querySelector("#stock-grid");
  const message = document.querySelector("#load-message");

  if (!bundle || !Array.isArray(bundle.recommendations)) {
    message.textContent = "尚未找到每日推薦資料，請先執行每日推薦排程。";
    document.querySelectorAll("[data-status]").forEach(el => el.textContent = "無資料");
    return;
  }

  const rows = bundle.recommendations;
  const generatedAt = bundle.generated_at_local
    ? new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(new Date(bundle.generated_at_local))
    : "—";
  document.querySelectorAll("[data-as-of]").forEach(el => el.textContent = bundle.as_of_date || "—");
  document.querySelectorAll("[data-count]").forEach(el => el.textContent = rows.length);
  document.querySelectorAll("[data-status]").forEach(el => el.textContent = "更新完成");
  document.querySelectorAll("[data-generated]").forEach(el => el.textContent = generatedAt);
  message.textContent = `共 ${rows.length} 檔合格；最多顯示 10 檔，不足不補。點選可查看理由與價格資訊。`;
  if (rows.length === 0) {
    message.textContent = "今日沒有符合發布條件的股票。";
  }

  const template = document.querySelector("#stock-template");
  const number = value => value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toFixed(2)
    : "—";
  const svgNS = "http://www.w3.org/2000/svg";

  function linePath(values, x, y) {
    let started = false;
    return values.map((value, i) => {
      if (!Number.isFinite(Number(value))) return "";
      const command = started ? "L" : "M";
      started = true;
      return `${command}${x(i).toFixed(1)},${y(Number(value)).toFixed(1)}`;
    }).join(" ");
  }

  function svgElement(name, attrs = {}) {
    const element = document.createElementNS(svgNS, name);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function aggregateBars(history, period) {
    if (period === "day") return history.slice(-120);
    const groups = new Map();
    history.forEach(row => {
      const date = new Date(`${row.date}T00:00:00`);
      let key;
      if (period === "week") {
        const monday = new Date(date);
        const day = (date.getDay() + 6) % 7;
        monday.setDate(date.getDate() - day);
        key = monday.toISOString().slice(0, 10);
      } else {
        key = row.date.slice(0, 7);
      }
      const current = groups.get(key);
      if (!current) {
        groups.set(key, {
          date: row.date,
          open_price: row.open_price,
          high_price: row.high_price,
          low_price: row.low_price,
          close_price: row.close_price,
          volume: Number(row.volume) || 0,
          trust_buy: Number(row.trust_buy) || 0
        });
      } else {
        current.date = row.date;
        current.high_price = Math.max(Number(current.high_price), Number(row.high_price));
        current.low_price = Math.min(Number(current.low_price), Number(row.low_price));
        current.close_price = row.close_price;
        current.volume += Number(row.volume) || 0;
        current.trust_buy += Number(row.trust_buy) || 0;
      }
    });
    return Array.from(groups.values()).slice(period === "week" ? -104 : -36);
  }

  function movingAverage(bars, window) {
    return bars.map((_, index) => {
      if (index + 1 < window) return null;
      const values = bars.slice(index-window+1, index+1).map(row => Number(row.close_price));
      return values.every(Number.isFinite) ? values.reduce((a, b) => a+b, 0) / window : null;
    });
  }

  function drawPriceChart(host, history, enabledMAs = [5, 10, 20]) {
    host.replaceChildren();
    const bars = history.slice(-120).filter(row =>
      ["open_price", "high_price", "low_price", "close_price"].every(
        key => Number.isFinite(Number(row[key]))
      )
    );
    const width = 760, height = 360;
    const pad = { l: 88, r: 12, t: 22, b: 20 };
    const priceBottom = 205, volumeTop = 230, volumeBottom = 278;
    const trustTop = 298, trustBottom = 344, trustZero = 321;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const averages = Object.fromEntries(enabledMAs.map(window => [window, movingAverage(bars, window)]));
    const values = bars.flatMap(row => [Number(row.high_price), Number(row.low_price)])
      .concat(Object.values(averages).flat().filter(Number.isFinite));
    if (!values.length) {
      host.textContent = "此期間沒有可用圖表資料";
      return;
    }
    const min = Math.min(...values), max = Math.max(...values);
    const margin = Math.max((max - min) * .08, max * .01);
    const low = min - margin, high = max + margin, spread = high - low;
    const plotWidth = width - pad.l - pad.r;
    const x = i => pad.l + (i + .5) * plotWidth / Math.max(bars.length, 1);
    const y = value => pad.t + (high - value) * (priceBottom - pad.t) / spread;

    const defs = svgElement("defs");
    const clipId = `price-clip-${bars.at(-1)?.date}`;
    const clip = svgElement("clipPath", { id: clipId });
    clip.appendChild(svgElement("rect", { x: pad.l, y: pad.t, width: plotWidth, height: priceBottom-pad.t }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    [0, .5, 1].forEach(ratio => {
      const value = high - spread * ratio;
      svg.appendChild(svgElement("line", { x1: pad.l, x2: width-pad.r, y1: y(value), y2: y(value), class: "chart-gridline" }));
      const label = svgElement("text", { x: pad.l-7, y: y(value)+3, class: "chart-label", "text-anchor": "end" });
      label.textContent = value.toFixed(1);
      svg.appendChild(label);
    });

    const candleWidth = Math.max(1.5, Math.min(7, plotWidth / Math.max(bars.length, 1) * .64));
    const candleLayer = svgElement("g", { "clip-path": `url(#${clipId})` });
    bars.forEach((bar, index) => {
      const open = Number(bar.open_price), close = Number(bar.close_price);
      const rising = close >= open;
      const color = rising ? "#d84f45" : "#198a63";
      candleLayer.appendChild(svgElement("line", {
        x1: x(index), x2: x(index), y1: y(Number(bar.high_price)),
        y2: y(Number(bar.low_price)), stroke: color, "stroke-width": 1
      }));
      candleLayer.appendChild(svgElement("rect", {
        x: x(index)-candleWidth/2, y: Math.min(y(open), y(close)),
        width: candleWidth, height: Math.max(1, Math.abs(y(open)-y(close))),
        fill: rising ? color : "#fff", stroke: color, "stroke-width": 1
      }));
    });
    svg.appendChild(candleLayer);
    const maColors = { 5: "#df6c4f", 10: "#bd8b2d", 20: "#0f6b65", 60: "#7896a5" };
    Object.entries(averages).forEach(([window, values]) => {
      svg.appendChild(svgElement("path", {
        d: linePath(values, x, y), fill: "none", stroke: maColors[window],
        "stroke-width": 1.5, opacity: .95, "clip-path": `url(#${clipId})`
      }));
    });

    const barWidth = Math.max(1.2, Math.min(5, plotWidth / bars.length * .65));
    const volumeMax = Math.max(...bars.map(row => Number(row.volume) || 0), 1);
    const trustMax = Math.max(...bars.map(row => Math.abs(Number(row.trust_buy) || 0)), 1);
    bars.forEach((bar, index) => {
      const rising = Number(bar.close_price) >= Number(bar.open_price);
      const volumeHeight = (Number(bar.volume) || 0) / volumeMax * (volumeBottom-volumeTop);
      svg.appendChild(svgElement("rect", {
        x: x(index)-barWidth/2, y: volumeBottom-volumeHeight,
        width: barWidth, height: volumeHeight,
        fill: rising ? "#d84f45" : "#198a63", opacity: ".48"
      }));
      const trust = Number(bar.trust_buy) || 0;
      const trustHeight = Math.abs(trust) / trustMax * (trustBottom-trustTop) / 2;
      svg.appendChild(svgElement("rect", {
        x: x(index)-barWidth/2,
        y: trust >= 0 ? trustZero-trustHeight : trustZero,
        width: barWidth, height: trustHeight,
        fill: trust >= 0 ? "#d84f45" : "#198a63", opacity: ".78"
      }));
    });
    svg.append(
      svgElement("line", { x1: pad.l, x2: width-pad.r, y1: priceBottom, y2: priceBottom, class: "chart-axis" }),
      svgElement("line", { x1: pad.l, x2: width-pad.r, y1: volumeBottom, y2: volumeBottom, class: "chart-axis" }),
      svgElement("line", { x1: pad.l, x2: width-pad.r, y1: trustZero, y2: trustZero, class: "chart-gridline" })
    );
    [
      ["成交量", (volumeTop + volumeBottom) / 2 + 4],
      ["投信買賣超", (trustTop + trustBottom) / 2 + 4]
    ].forEach(([text, labelY]) => {
      const label = svgElement("text", {
        x: pad.l - 10, y: labelY, class: "chart-section-label",
        "text-anchor": "end"
      });
      label.textContent = text;
      svg.appendChild(label);
    });
    const last = bars.at(-1);
    const latest = svgElement("text", { x: width-pad.r, y: 12, class: "chart-latest", "text-anchor": "end" });
    latest.textContent = `日K · 最新 ${number(last.close_price)} · ${bars.length}根`;
    svg.appendChild(latest);
    const dates = svgElement("text", { x: pad.l, y: height-5, class: "chart-label" });
    dates.textContent = `${bars[0]?.date || ""}  →  ${last?.date || ""}`;
    svg.appendChild(dates);

    const crosshair = svgElement("line", {
      y1: pad.t, y2: trustBottom, class: "chart-crosshair", visibility: "hidden"
    });
    const tooltip = svgElement("g", { class: "chart-tooltip", visibility: "hidden" });
    const tooltipBox = svgElement("rect", { width: 178, height: 96, rx: 8 });
    const tooltipText = svgElement("text", { x: 10, y: 17 });
    tooltip.append(tooltipBox, tooltipText);
    const overlay = svgElement("rect", {
      x: pad.l, y: pad.t, width: plotWidth, height: trustBottom-pad.t,
      fill: "transparent", class: "chart-hover-layer"
    });
    const formatAmount = value => {
      const amount = Number(value) || 0;
      if (Math.abs(amount) >= 1_000_000) return `${(amount/1_000_000).toFixed(2)}M`;
      if (Math.abs(amount) >= 1_000) return `${(amount/1_000).toFixed(1)}K`;
      return amount.toFixed(0);
    };
    const showTooltip = event => {
      const bounds = svg.getBoundingClientRect();
      const pointerX = (event.clientX - bounds.left) / bounds.width * width;
      const index = Math.max(0, Math.min(
        bars.length-1,
        Math.round((pointerX-pad.l) / plotWidth * bars.length - .5)
      ));
      const bar = bars[index];
      const currentX = x(index);
      crosshair.setAttribute("x1", currentX);
      crosshair.setAttribute("x2", currentX);
      crosshair.setAttribute("visibility", "visible");
      tooltipText.replaceChildren();
      [
        bar.date,
        `開 ${number(bar.open_price)}　高 ${number(bar.high_price)}`,
        `低 ${number(bar.low_price)}　收 ${number(bar.close_price)}`,
        `量 ${formatAmount(bar.volume)}　投信 ${formatAmount(bar.trust_buy)}`
      ].forEach((text, line) => {
        const tspan = svgElement("tspan", { x: 10, dy: line ? 21 : 0 });
        tspan.textContent = text;
        tooltipText.appendChild(tspan);
      });
      const tooltipX = currentX > width-210 ? currentX-190 : currentX+10;
      tooltip.setAttribute("transform", `translate(${tooltipX},${pad.t+5})`);
      tooltip.setAttribute("visibility", "visible");
    };
    overlay.addEventListener("pointermove", showTooltip);
    overlay.addEventListener("pointerdown", showTooltip);
    overlay.addEventListener("pointerleave", () => {
      crosshair.setAttribute("visibility", "hidden");
      tooltip.setAttribute("visibility", "hidden");
    });
    svg.append(crosshair, tooltip, overlay);
    host.appendChild(svg);
  }

  function drawScoreChart(host, stock) {
    const scores = [
      ["趨勢", stock.trend_score, false],
      ["上漲機率分數", stock.up_probability, false],
      ["下跌風險", stock.downside_risk, true],
      ["信心", stock.confidence_score, false]
    ];
    const wrapper = document.createElement("div");
    wrapper.className = "score-bars";
    scores.forEach(([label, value, risk]) => {
      const row = document.createElement("div");
      const riskValue = Number(value) || 0;
      const riskLevel = risk
        ? riskValue <= 35 ? " risk-low" : riskValue <= 50 ? " risk-medium" : " risk-high"
        : "";
      row.className = `score-row${riskLevel}`;
      row.innerHTML = `<span></span><strong></strong><div class="score-track"><span></span></div>`;
      row.children[0].textContent = label;
      row.children[1].textContent = number(value);
      row.querySelector(".score-track span").style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
      wrapper.appendChild(row);
    });
    host.appendChild(wrapper);
  }

  function renderCharts(card, stock) {
    if (card.dataset.chartsRendered) return;
    card.dataset.chartsRendered = "true";
    const history = bundle.history?.[String(stock.stock_id)] || [];
    const priceHost = card.querySelector(".price-chart .chart-host");
    const maInputs = card.querySelectorAll(".ma-switch input");
    const redrawPrice = () => {
      const enabled = Array.from(maInputs).filter(input => input.checked).map(input => Number(input.value));
      drawPriceChart(priceHost, history, enabled);
    };
    maInputs.forEach(input => input.addEventListener("change", redrawPrice));
    redrawPrice();
    drawScoreChart(card.querySelector(".score-chart .chart-host"), stock);
  }

  rows.forEach((stock, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector(".rank").textContent = String(index + 1).padStart(2, "0");
    card.querySelector(".industry").textContent = stock.industry || "未分類";
    card.querySelector(".name").textContent = stock.stock_name || stock.stock_id;
    card.querySelector(".code").textContent = `${stock.stock_id} · ${stock.market || ""}`;
    card.querySelector(".score").textContent = number(stock.recommendation_score);

    const buyLow = Number(stock.buy_range_low);
    const buyHigh = Number(stock.buy_range_high);
    const buyAverage = Number.isFinite(buyLow) && Number.isFinite(buyHigh)
      ? (buyLow + buyHigh) / 2
      : null;
    const stats = [
      { label: "最新價格", value: number(stock.latest_price), note: "目前資料日收盤", tone: "current" },
      {
        label: "參考買進區間",
        value: `${number(stock.buy_range_low)}–${number(stock.buy_range_high)}`,
        note: `區間平均 ${number(buyAverage)}`,
        tone: "entry"
      },
      { label: "目標價格", value: number(stock.target_price), note: "模型報酬推估", tone: "target" },
      { label: "停損參考價格", value: number(stock.stop_loss), note: "風險控制參考", tone: "stop" }
    ];
    stats.forEach(({ label, value, note, tone }) => {
      const cell = document.createElement("div");
      cell.className = `detail-stat price-stat ${tone}`;
      const title = document.createElement("span");
      title.textContent = label;
      const content = document.createElement("strong");
      content.textContent = value;
      const description = document.createElement("small");
      description.textContent = note;
      cell.append(title, content, description);
      card.querySelector(".detail-stats").appendChild(cell);
    });

    const positives = [
      "成交量與近期投信買超通過基本篩選",
      `推薦分數 ${number(stock.recommendation_score)}，下跌風險 ${number(stock.downside_risk)}，符合發布門檻`,
      `趨勢分數 ${number(stock.trend_score)}，上漲機率分數 ${number(stock.up_probability)}`
    ];
    positives.forEach(text => {
      const li = document.createElement("li");
      li.textContent = text;
      card.querySelector(".positive-list").appendChild(li);
    });
    const marketName = stock.market === "TWSE" ? "上市" : stock.market === "TPEX" ? "上櫃" : stock.market || "—";
    const revenuePeriod = stock.revenue_year && stock.revenue_month
      ? `${stock.revenue_year}/${String(stock.revenue_month).padStart(2, "0")}`
      : "—";
    const profileRows = [
      ["公司名稱", stock.stock_name || "—"],
      ["股票代號", stock.stock_id],
      ["市場", marketName],
      ["產業", stock.industry || "—"],
      ["本益比", number(stock.pe_ratio)],
      ["股價淨值比", number(stock.pb_ratio)],
      ["殖利率", stock.dividend_yield_pct == null ? "—" : `${number(stock.dividend_yield_pct)}%`],
      ["營收資料期", revenuePeriod],
      ["月營收年增", stock.revenue_yoy_pct == null ? "—" : `${number(stock.revenue_yoy_pct)}%`],
      ["累計營收年增", stock.cumulative_revenue_yoy_pct == null ? "—" : `${number(stock.cumulative_revenue_yoy_pct)}%`]
    ];
    const profile = card.querySelector(".company-profile dl");
    profileRows.forEach(([label, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      row.append(term, description);
      profile.appendChild(row);
    });
    const focus = bundle.company_focus?.companies?.[String(stock.stock_id)];
    if (focus?.highlights?.length) {
      const focusBadge = document.createElement("span");
      focusBadge.className = "focus-badge";
      focusBadge.textContent = "近期發展已更新";
      card.querySelector(".stock-identity").appendChild(focusBadge);
      const focusPanel = card.querySelector(".company-focus");
      focusPanel.hidden = false;
      focus.highlights.forEach(text => {
        const li = document.createElement("li");
        li.textContent = text;
        focusPanel.querySelector("ul").appendChild(li);
      });
      focusPanel.querySelector(".focus-meta").textContent =
        `公司資料截至 ${focus.as_of_date || bundle.company_focus.updated_at || "—"}；為官方揭露方向，不代表成果保證。`;
      (focus.sources || []).forEach((source, index) => {
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || `官方來源 ${index + 1}`;
        focusPanel.querySelector(".focus-sources").appendChild(link);
      });
    }
    const official = bundle.official_updates?.companies?.[String(stock.stock_id)];
    if (official?.display === true) {
      const panel = document.createElement("section");
      panel.className = "official-updates";
      const heading = document.createElement("h4");
      heading.textContent = "最新官方資訊";
      panel.appendChild(heading);
      const items = document.createElement("ul");
      (official.disclosures || []).slice(0, 3).forEach(item => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `${item.date}｜${item.title}`;
        li.appendChild(link);
        items.appendChild(li);
      });
      (official.official_site?.links || []).slice(0, 3).forEach(item => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `公司官網｜${item.title}`;
        li.appendChild(link);
        items.appendChild(li);
      });
      panel.appendChild(items);
      const meta = document.createElement("p");
      meta.className = "official-updates-meta";
      meta.textContent = `資料截至 ${official.as_of_date || bundle.official_updates.updated_at || "—"}；僅整理官方揭露，不含媒體消息。`;
      panel.appendChild(meta);
      card.querySelector(".stock-details").appendChild(panel);
    }
    card.querySelector(".formula").textContent =
      `推薦分數＝趨勢 45%＋上漲機率分數 25%＋反向下跌風險 20%＋信心 10%；上漲機率分數是模型指標，不代表實際機率；資料日 ${stock.screening_date || bundle.as_of_date}`;

    const button = card.querySelector(".stock-summary");
    button.addEventListener("click", () => {
      const open = card.classList.toggle("open");
      button.setAttribute("aria-expanded", String(open));
      if (open) renderCharts(card, stock);
    });
    grid.appendChild(card);
  });

  const visibleTrackingStatuses = new Set(["active", "target_reached", "stop_triggered", "model_expired", "policy_disqualified"]);
  const trackingMinimumTargetUpsidePct = Number(bundle.minimum_target_upside_pct || 0);
  const trackingRows = Array.isArray(bundle.tracking)
    ? bundle.tracking.filter(row => {
        const openedPrice = Number(row.opened_price);
        const originalTarget = Number(row.original_target);
        const targetUpsidePct = openedPrice > 0
          ? (originalTarget / openedPrice - 1) * 100
          : -Infinity;
        return visibleTrackingStatuses.has(row.status)
          && targetUpsidePct >= trackingMinimumTargetUpsidePct - 1e-9;
      })
    : [];
  const trackingBody = document.querySelector("#tracking-body");
  const trackingSearch = document.querySelector("#tracking-search");
  const trackingLifecycle = document.querySelector("#tracking-lifecycle");
  const trackingStatus = document.querySelector("#tracking-status");
  const trackingSort = document.querySelector("#tracking-sort");
  const trackingPrev = document.querySelector("#tracking-prev");
  const trackingNext = document.querySelector("#tracking-next");
  const trackingRange = document.querySelector("#tracking-range");
  const trackingPage = document.querySelector("#tracking-page");
  const trackingLabels = [
    "股票", "原始推薦", "追蹤價格", "原始停利",
    "原始停損", "追蹤日數", "目前狀態"
  ];
  trackingLabels.splice(5, 0, "結案日期／價格");
  const trackingPageSize = 10;
  let currentTrackingPage = 1;
  const statusLabels = {
    active: "持續追蹤",
    target_reached: "已達原始目標",
    stop_triggered: "已跌破原始停損",
    model_expired: "模型預測失效",
    policy_disqualified: "不符合新規格"
  };
  function filteredTrackingRows() {
    const keyword = trackingSearch.value.trim().toLowerCase();
    const lifecycle = trackingLifecycle.value;
    const status = trackingStatus.value;
    const filtered = trackingRows.filter(track => {
      const searchable = `${track.stock_name || ""} ${track.stock_id || ""}`.toLowerCase();
      const lifecycleMatch = lifecycle === "all"
        || (lifecycle === "active" && !track.closed_date)
        || (lifecycle === "closed" && Boolean(track.closed_date));
      return (!keyword || searchable.includes(keyword))
        && lifecycleMatch
        && (status === "all" || track.status === status);
    });
    return filtered.sort((a, b) => {
      if (trackingSort.value === "days_desc") {
        return Number(b.trading_days || 0) - Number(a.trading_days || 0);
      }
      return String(b.opened_date || "").localeCompare(String(a.opened_date || ""))
        || Number(b.track_id || 0) - Number(a.track_id || 0);
    });
  }

  function renderTrackingTable() {
    const filtered = filteredTrackingRows();
    const totalPages = Math.max(1, Math.ceil(filtered.length / trackingPageSize));
    currentTrackingPage = Math.min(currentTrackingPage, totalPages);
    const start = (currentTrackingPage - 1) * trackingPageSize;
    const pageRows = filtered.slice(start, start + trackingPageSize);
    trackingBody.replaceChildren();
    pageRows.forEach(track => {
      const row = document.createElement("tr");
      const values = [
        `${track.stock_name || track.stock_id} ${track.stock_id}`,
        `${track.opened_date || "—"}／${number(track.opened_price)}`,
        number(track.latest_price),
        number(track.original_target),
        number(track.original_stop),
        track.closed_date ? `${track.closed_date}／${number(track.latest_price)}` : "—",
        `${track.trading_days || 0}`,
        statusLabels[track.status] || track.status || "—"
      ];
      values.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        cell.textContent = value;
        cell.dataset.label = trackingLabels[index];
        if (index === values.length - 1) {
          cell.className = `tracking-status ${track.status || ""}`;
        }
        row.appendChild(cell);
      });
      trackingBody.appendChild(row);
    });
    if (!pageRows.length) {
      const row = document.createElement("tr");
      row.className = "tracking-empty";
      const cell = document.createElement("td");
      cell.colSpan = trackingLabels.length;
      cell.textContent = "沒有符合目前條件的追蹤資料";
      row.appendChild(cell);
      trackingBody.appendChild(row);
    }
    trackingRange.textContent = filtered.length
      ? `目前顯示 ${start + 1}–${start + pageRows.length} 筆，共 ${filtered.length} 筆`
      : "目前顯示 0 筆";
    trackingPage.textContent = `${currentTrackingPage}／${totalPages}`;
    trackingPrev.disabled = currentTrackingPage <= 1;
    trackingNext.disabled = currentTrackingPage >= totalPages;
  }

  [trackingSearch, trackingLifecycle, trackingStatus, trackingSort].forEach(control => {
    control.addEventListener(control === trackingSearch ? "input" : "change", () => {
      currentTrackingPage = 1;
      renderTrackingTable();
    });
  });
  trackingPrev.addEventListener("click", () => {
    currentTrackingPage = Math.max(1, currentTrackingPage - 1);
    renderTrackingTable();
  });
  trackingNext.addEventListener("click", () => {
    currentTrackingPage += 1;
    renderTrackingTable();
  });
  renderTrackingTable();
  const closedTracking = trackingRows.filter(row => Boolean(row.closed_date));
  const targetReached = closedTracking.filter(row => row.status === "target_reached");
  const stopTriggered = closedTracking.filter(row => row.status === "stop_triggered");
  const modelExpired = closedTracking.filter(row => row.status === "model_expired");
  const outcomeTracking = closedTracking.filter(row =>
    row.status === "target_reached" || row.status === "stop_triggered"
  );
  const trackingRate = count => outcomeTracking.length
    ? `${(count / outcomeTracking.length * 100).toFixed(1)}%`
    : "—";
  const closedRate = count => closedTracking.length
    ? `${(count / closedTracking.length * 100).toFixed(1)}%`
    : "—";
  const setTrackingStat = (name, value) => {
    const element = document.querySelector(`[data-tracking-stat="${name}"]`);
    if (element) element.textContent = value;
  };
  const averageTargetDays = targetReached.length
    ? targetReached.reduce((sum, row) => sum + Number(row.trading_days || 0), 0) / targetReached.length
    : null;
  setTrackingStat("closed", closedTracking.length);
  setTrackingStat("target-rate", trackingRate(targetReached.length));
  setTrackingStat("target-count", `${targetReached.length} 輪`);
  setTrackingStat("stop-rate", trackingRate(stopTriggered.length));
  setTrackingStat("stop-count", `${stopTriggered.length} 輪`);
  setTrackingStat("expired-rate", closedRate(modelExpired.length));
  setTrackingStat("expired-count", `${modelExpired.length} 輪`);
  setTrackingStat("active", trackingRows.length - closedTracking.length);
  setTrackingStat("average-days", averageTargetDays === null ? "—" : averageTargetDays.toFixed(1));
  const activeTracking = trackingRows.filter(row => !row.closed_date).length;
  document.querySelector("#tracking-message").textContent = trackingRows.length
    ? `目前追蹤中 ${activeTracking} 檔；表內同時保留最近結案紀錄，原始目標不會被後續更新覆蓋。`
    : "目前尚無推薦後追蹤資料；下一次每日流程會自動建立。";

  const industries = Object.values(rows.reduce((acc, row) => {
    const name = row.industry || "未分類";
    const score = Number(row.recommendation_score) || 0;
    acc[name] ||= { name, count: 0, total: 0 };
    acc[name].count += 1;
    acc[name].total += score;
    return acc;
  }, {})).map(item => ({ ...item, average: item.total / item.count }))
    .sort((a, b) => b.count - a.count || b.average - a.average);

  const industryList = document.querySelector("#industry-list");
  industries.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "industry-row";
    row.innerHTML = `<span class="place">${String(index + 1).padStart(2, "0")}</span>
      <strong></strong><span class="industry-bar"><span></span></span><span class="industry-score"></span>`;
    row.querySelector("strong").textContent = `${item.name}（${item.count} 檔）`;
    row.querySelector(".industry-bar span").style.width = `${Math.min(100, item.average)}%`;
    row.querySelector(".industry-score").textContent = item.average.toFixed(2);
    industryList.appendChild(row);
  });

  if (new URLSearchParams(window.location.search).has("preview")) {
    document.querySelector(".stock-summary")?.click();
  }
})();
