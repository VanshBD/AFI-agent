/**
 * AFI Fraud Command Center — Frontend Client Logic
 * Consumes live InvestigationService API, renders SVG Graph, Evidence Ledger, Hypotheses,
 * Adversarial Perspectives, Contradictions, Sensitivities, and Policy Routing.
 */

document.addEventListener("DOMContentLoaded", () => {
  const caseSelect = document.getElementById("caseSelect");
  const runBtn = document.getElementById("runBtn");
  const evidenceFilter = document.getElementById("evidenceFilter");

  let currentInvestigationData = null;
  let allEvidence = [];

  let casesCache = [];

  // Key for persisting selection across browser refreshes
  const STORAGE_KEY_SELECTED_CASE = "afi_selected_case_id";

  function getActiveCaseIdFromUrlOrStorage(cases) {
    const urlParams = new URLSearchParams(window.location.search);
    const paramCaseId = urlParams.get("caseId");
    if (paramCaseId && cases.some((c) => c.case_id === paramCaseId)) {
      return paramCaseId;
    }
    const storedCaseId = localStorage.getItem(STORAGE_KEY_SELECTED_CASE);
    if (storedCaseId && cases.some((c) => c.case_id === storedCaseId)) {
      return storedCaseId;
    }
    return cases[0]?.case_id || "HHG-001";
  }

  // 1. Fetch available trigger cases from server
  async function loadCases() {
    try {
      const res = await fetch("/api/cases");
      casesCache = await res.json();
      caseSelect.innerHTML = "";
      for (const c of casesCache) {
        const opt = document.createElement("option");
        opt.value = c.case_id;
        opt.textContent = `${c.case_id} — Txn ${c.flagged_txn_id} (${c.trigger_type})`;
        caseSelect.appendChild(opt);
      }

      // Restore previously selected case
      const targetCaseId = getActiveCaseIdFromUrlOrStorage(casesCache);
      caseSelect.value = targetCaseId;
      return targetCaseId;
    } catch (err) {
      console.error("Failed to load cases:", err);
      return null;
    }
  }

  // 1b. Present initial trigger selection state (clean slate: all investigation fields blank)
  function renderTriggerReadyState(caseId) {
    const caseObj = casesCache.find((c) => c.case_id === caseId);

    // Keep all fields completely unpopulated / blank (—) until the user explicitly runs the investigation
    document.getElementById("valInvId").textContent = "—";
    document.getElementById("valTrgId").textContent = caseObj ? caseObj.case_id : "—";
    document.getElementById("valTxnId").textContent = caseObj ? caseObj.flagged_txn_id : "—";
    document.getElementById("valCustCard").textContent = caseObj ? `${caseObj.customer_id} / ${caseObj.card_id}` : "—";
    document.getElementById("valCutoff").textContent = caseObj ? caseObj.opened_at : "—";
    document.getElementById("valRiskScore").textContent = "—";

    const statusBadge = document.getElementById("valStatus");
    statusBadge.textContent = "READY TO INVESTIGATE";
    statusBadge.className = "status-badge investigating";

    // Clear ledger, graph, and panels completely
    allEvidence = [];
    document.getElementById("evidenceTbody").innerHTML = '<tr><td colspan="7" class="empty-cell">Click "▶ RUN INVESTIGATION" to execute live agentic investigation and populate evidence ledger.</td></tr>';
    document.getElementById("graphSvg").innerHTML = '<text x="300" y="150" fill="#64748b" font-size="13" text-anchor="middle" font-family="sans-serif">Select case and click "▶ RUN INVESTIGATION" to query live graph.</text>';
    document.getElementById("hypothesesList").innerHTML = '<div class="empty-state">Investigation not yet initiated. Click "▶ RUN INVESTIGATION".</div>';
    document.getElementById("prosecutorFindings").innerHTML = '<div class="sub-text">Awaiting investigation run.</div>';
    document.getElementById("defenseFindings").innerHTML = '<div class="sub-text">Awaiting investigation run.</div>';
    document.getElementById("contradictionsList").innerHTML = '<div class="sub-text">Awaiting investigation run.</div>';
    document.getElementById("sensitivityList").innerHTML = '<div class="sub-text">Awaiting investigation run.</div>';
    document.getElementById("auditTimeline").innerHTML = '<div class="empty-state">Click "▶ RUN INVESTIGATION" to start execution trace.</div>';

    // Clear NBA governance panel
    document.getElementById("nbaAction").textContent = "—";
    document.getElementById("nbaRationale").textContent = 'Select a case and click "▶ RUN INVESTIGATION" to execute graph analysis and determine optimal action.';
    document.getElementById("nbaAuthBadge").textContent = "PENDING";
    document.getElementById("nbaExecStatus").textContent = "Awaiting run";
    document.getElementById("nbaExecStatus").style.color = "var(--text-secondary)";

    // Clear NBA lifecycle sub-boxes
    document.getElementById("nbaInitialList").innerHTML = '<div class="sub-text">Awaiting run.</div>';
    document.getElementById("nbaInitialRoute").textContent = "PENDING";
    document.getElementById("nbaInitialRoute").className = "route-pill neutral";
    document.getElementById("nbaEvidenceBadge").textContent = "PENDING";
    document.getElementById("nbaEvidenceBadge").className = "route-pill neutral";
    document.getElementById("nbaEvidenceContent").innerHTML = '<div class="sub-text">Awaiting run.</div>';
    document.getElementById("nbaFinalContent").innerHTML = '<div class="sub-text">Awaiting run.</div>';
    document.getElementById("nbaSarBadge").textContent = "PENDING";
    document.getElementById("nbaSarBadge").className = "route-pill neutral";

    renderStepper("triage", false);
  }


  // 2. Run live investigation for selected case through full agentic pipeline
  async function executeInvestigation() {
    const selectedCaseId = caseSelect.value;
    if (!selectedCaseId) return;

    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="btn-icon">⏳</span> RUNNING LIVE AGENTS...';

    // Show live execution in UI status
    const statusBadge = document.getElementById("valStatus");
    statusBadge.textContent = "INVESTIGATING (LIVE AGENTS RUNNING)";
    statusBadge.className = "status-badge investigating";
    document.getElementById("evidenceTbody").innerHTML = '<tr><td colspan="7" class="empty-cell" style="color:var(--accent-primary);"><span style="animation: pulse 1s infinite;">Executing real-time multi-agent graph traversal, GSQL algorithms & GraphRAG synthesis across TigerGraph...</span></td></tr>';
    document.getElementById("auditTimeline").innerHTML = '<div class="audit-entry"><span class="audit-ts">RUNNING</span> <span class="audit-action">Dispatched live agents: <strong>TransactionHunter, GraphHunter, DeviceHunter, CaseMemoryHunter, AdversarialAnalyzer</strong></span></div>';

    try {
      // Execute genuine live pipeline on server
      const liveRes = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: selectedCaseId }),
      });

      const liveData = await liveRes.json();
      if (!liveRes.ok) {
        throw new Error(liveData.error || `Server returned HTTP ${liveRes.status}`);
      }

      currentInvestigationData = liveData;
      // Cache this completed run for page refreshes
      localStorage.setItem(`afi_case_data_${selectedCaseId}`, JSON.stringify(liveData));
      renderInvestigation(liveData);
    } catch (err) {
      console.error("Live investigation execution failed:", err);
      alert("Live investigation failed: " + err.message);
      statusBadge.textContent = "EXECUTION FAILED";
      statusBadge.className = "status-badge escalated";
      document.getElementById("evidenceTbody").innerHTML = `<tr><td colspan="7" class="empty-cell" style="color:var(--status-fraud);">Investigation failed: ${err.message}</td></tr>`;
    } finally {

      runBtn.disabled = false;
      runBtn.innerHTML = '<span class="btn-icon">▶</span> RUN INVESTIGATION';
    }
  }




  // 3. Render all investigation dashboard panels
  function renderInvestigation(data) {
    const state = data.state;
    const lastStep = data.stepResults[data.stepResults.length - 1];
    const isFinalized = state.continuationDecision?.action === "STOP" || state.status === "completed" || state.status === "escalated";

    // Header metadata
    document.getElementById("valInvId").textContent = state.investigationId;
    document.getElementById("valTrgId").textContent = state.triggerId;
    document.getElementById("valTxnId").textContent = state.flaggedTransactionId;
    document.getElementById("valCustCard").textContent = `${state.customerId} / ${state.cardId}`;
    document.getElementById("valCutoff").textContent = state.investigationCutoff;
    document.getElementById("valRiskScore").textContent = state.riskScore !== undefined ? state.riskScore.toFixed(2) : "N/A";

    const statusBadge = document.getElementById("valStatus");
    if (state.status === "completed") {
      statusBadge.textContent = "COMPLETED";
      statusBadge.className = "status-badge completed";
    } else if (state.status === "escalated") {
      statusBadge.textContent = "ESCALATED (APPROVAL REQUIRED)";
      statusBadge.className = "status-badge escalated";
    } else if (state.status === "investigating") {
      statusBadge.textContent = "INVESTIGATING";
      statusBadge.className = "status-badge investigating";
    } else {
      statusBadge.textContent = state.status.toUpperCase();
      statusBadge.className = `status-badge ${state.status}`;
    }

    // Update phase progression stepper
    renderStepper(state.currentPhase, isFinalized);

    // Render Evidence Ledger
    allEvidence = data.allEvidence || [];
    if (allEvidence.length === 0 && data.stepResults) {
      for (const step of data.stepResults) {
        allEvidence.push(...step.newEvidence);
      }
    }
    renderEvidenceTable();

    // Render SVG Graph Context
    renderGraph(data.graphNodes, data.graphEdges);

    // Render Hypotheses
    renderHypotheses(data.hypotheses || (lastStep ? lastStep.updatedHypotheses : []));

    // Render Adversarial Analysis (Prosecutor vs Defense)
    const advResult = data.adversarialResult || (lastStep ? lastStep.adversarialResult : null);
    renderAdversarial(advResult);

    // Render Contradictions & Sensitivities
    const sensitivities = data.decisionSensitivities || (lastStep ? lastStep.decisionSensitivities : []);
    renderContradictionsAndSensitivities(state.contradictions, sensitivities);

    // Render NBA & Authorization
    const policyResult = data.policyResult || (lastStep ? lastStep.policyResult : null);
    renderNBA(state.nextBestAction, policyResult, data.officialCase);

    // Render Audit Timeline
    renderAuditTimeline(state.toolCallIds, state.continuationDecision, policyResult);
  }

  function renderStepper(currentPhase, isFinalized) {
    const steps = document.querySelectorAll(".stepper .step");
    const phaseOrder = [
      "triage",
      "initial_fact_gathering",
      "relationship_expansion",
      "historical_retrospective",
      "hypothesis_evaluation",
      "decision_and_nba",
    ];

    const curIdx = phaseOrder.indexOf(currentPhase);
    steps.forEach((st, idx) => {
      st.classList.remove("active", "completed");
      if (isFinalized) {
        // When finalized with sufficient evidence, all phases through decision are complete
        st.classList.add("completed");
      } else if (idx < curIdx) {
        st.classList.add("completed");
      } else if (idx === curIdx) {
        st.classList.add("active");
      }
    });
  }

  function renderEvidenceTable() {
    const tbody = document.getElementById("evidenceTbody");
    const filter = evidenceFilter.value;
    tbody.innerHTML = "";

    const filtered = allEvidence.filter((e) => {
      if (filter === "all") return true;
      return e.polarity === filter;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No matching evidence items found.</td></tr>';
      return;
    }

    for (const ev of filtered) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td title="${ev.evidenceId}"><strong>${ev.evidenceId}</strong></td>
        <td>${ev.category}</td>
        <td>${ev.entityType} ${ev.entityId !== "none" ? `(${ev.entityId})` : ""}</td>
        <td style="line-height:1.4;">${ev.observation}</td>
        <td><span class="polarity-tag ${ev.polarity}">${ev.polarity}</span></td>
        <td>${ev.decisionImpact}</td>
        <td><code title="${ev.provenance.queryOrSourceRef}">${ev.provenance.queryOrSourceRef}</code></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function renderGraph(nodes, edges) {
    const svg = document.getElementById("graphSvg");
    svg.innerHTML = "";
    if (!nodes || nodes.length === 0) return;

    svg.setAttribute("viewBox", "0 0 600 320");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Add arrow defs for directed edges
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#3a4f73"/>
      </marker>
    `;
    svg.appendChild(defs);

    const centerX = 300;
    const centerY = 145;
    const radius = Math.min(centerX, centerY) * 0.72;

    // Position nodes radially around center
    const nodeCoords = new Map();
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      nodeCoords.set(node.id, { x, y, node });
    });

    // Draw edges
    edges.forEach((edge) => {
      const src = nodeCoords.get(edge.source);
      const tgt = nodeCoords.get(edge.target);
      if (src && tgt) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", src.x);
        line.setAttribute("y1", src.y);
        line.setAttribute("x2", tgt.x);
        line.setAttribute("y2", tgt.y);
        line.setAttribute("stroke", "#3a4f73");
        line.setAttribute("stroke-width", "2");
        line.setAttribute("marker-end", "url(#arrow)");
        svg.appendChild(line);

        // Edge label
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", (src.x + tgt.x) / 2);
        text.setAttribute("y", (src.y + tgt.y) / 2 - 4);
        text.setAttribute("fill", "#94a3b8");
        text.setAttribute("font-size", "9");
        text.setAttribute("font-family", "monospace");
        text.setAttribute("text-anchor", "middle");
        text.textContent = edge.relationship;
        svg.appendChild(text);
      }
    });

    // Draw node circles & labels
    nodeCoords.forEach(({ x, y, node }) => {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", x);
      circle.setAttribute("cy", y);
      circle.setAttribute("r", "16");

      let fillColor = "#3b82f6";
      if (node.type === "CardProfile") fillColor = "#06b6d4";
      if (node.type === "Transaction") fillColor = "#f59e0b";
      if (node.type === "KnownCard") fillColor = "#ef4444";
      if (node.type === "ClosedCase") fillColor = "#8b5cf6";
      if (node.type === "DeviceProfile") fillColor = "#10b981";
      if (node.type === "EmailDomain") fillColor = "#ec4899";
      if (node.type === "BillingRegion") fillColor = "#6366f1";

      circle.setAttribute("fill", fillColor);
      circle.setAttribute("stroke", "#ffffff");
      circle.setAttribute("stroke-width", "2");
      g.appendChild(circle);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", x);
      label.setAttribute("y", y + 24);
      label.setAttribute("fill", "#f0f4fc");
      label.setAttribute("font-size", "10");
      label.setAttribute("font-weight", "600");
      label.setAttribute("font-family", "sans-serif");
      label.setAttribute("text-anchor", "middle");
      label.textContent = node.label;
      g.appendChild(label);

      svg.appendChild(g);
    });
  }

  function renderHypotheses(hypotheses) {
    const list = document.getElementById("hypothesesList");
    list.innerHTML = "";

    if (!hypotheses || hypotheses.length === 0) {
      list.innerHTML = '<div class="empty-state">No active hypotheses.</div>';
      return;
    }

    for (const h of hypotheses) {
      const card = document.createElement("div");
      card.className = "hyp-card";
      card.innerHTML = `
        <div class="hyp-title">${h.title}</div>
        <div class="hyp-meta">Status: <strong>${h.status}</strong> | Confidence: <strong>${(h.confidenceScore * 100).toFixed(0)}%</strong></div>
        <div class="hyp-meta">Supporting Facts: ${h.supportingEvidenceIds.length} | Contradicting: ${h.contradictingEvidenceIds.length}</div>
      `;
      list.appendChild(card);
    }
  }

  function renderAdversarial(adversarial) {
    const proseBox = document.getElementById("prosecutorFindings");
    const defBox = document.getElementById("defenseFindings");

    if (!adversarial) {
      proseBox.innerHTML = '<div class="sub-text">Run investigation to view findings.</div>';
      defBox.innerHTML = '<div class="sub-text">Run investigation to view findings.</div>';
      return;
    }

    if (adversarial.prosecutorFindings && adversarial.prosecutorFindings.length > 0) {
      proseBox.innerHTML = adversarial.prosecutorFindings.map((p) => `
        <div style="margin-bottom:6px;">
          <strong>${p.argument}</strong>
          <span class="route-pill ${p.strength === 'compelling' ? 'L2' : (p.strength === 'moderate' ? 'L1' : 'neutral')}" style="margin-left:6px;">${p.strength}</span>
        </div>
      `).join("");
    } else {
      proseBox.innerHTML = '<div class="sub-text">No conclusive fraud indicators detected in graph evidence.</div>';
    }

    if (adversarial.defenseFindings && adversarial.defenseFindings.length > 0) {
      defBox.innerHTML = adversarial.defenseFindings.map((d) => `
        <div style="margin-bottom:6px;">
          <strong>${d.argument}</strong>
          <span class="route-pill auto" style="margin-left:6px;">${d.strength}</span>
        </div>
      `).join("");
    } else {
      defBox.innerHTML = '<div class="sub-text">No mitigating benign factors identified.</div>';
    }
  }

  function renderContradictionsAndSensitivities(contradictions, sensitivities) {
    const contraList = document.getElementById("contradictionsList");
    const sensList = document.getElementById("sensitivityList");

    if (contradictions && contradictions.length > 0) {
      contraList.innerHTML = contradictions.map((c) => `
        <div class="contra-item">
          <strong>${c.contradictionId}:</strong> ${c.description}
          <div style="font-size:10px; color:#94a3b8; margin-top:2px;">Resolution: <strong>${c.resolutionStatus}</strong></div>
        </div>
      `).join("");
    } else {
      contraList.innerHTML = '<div class="sub-text">No active contradictions detected.</div>';
    }

    if (sensitivities && sensitivities.length > 0) {
      sensList.innerHTML = sensitivities.map((s) => `
        <div class="sens-item">
          <strong>Unknown:</strong> ${s.unknownFact}
          <div style="font-size:10px; color:#94a3b8; margin-top:2px;">Impact: <strong>${s.expectedImpact}</strong> | Can change action to: <strong>${s.potentiallyChangedActions.join(", ")}</strong></div>
        </div>
      `).join("");
    } else {
      sensList.innerHTML = '<div class="sub-text">No decision-critical sensitivities remaining. Investigation conclusive.</div>';
    }
  }

  function renderNBA(nba, policyResult, officialCase) {
    const actionEl = document.getElementById("nbaAction");
    const rationaleEl = document.getElementById("nbaRationale");
    const authBadge = document.getElementById("nbaAuthBadge");
    const execStatus = document.getElementById("nbaExecStatus");
    const policyTag = document.getElementById("nbaPolicyTag");
    const approvalTitle = document.querySelector("#nbaApprovalBox .approval-title");
    const approvalDesc = document.getElementById("nbaApprovalDesc");

    // Lifecycle elements
    const initialList = document.getElementById("nbaInitialList");
    const initialRoute = document.getElementById("nbaInitialRoute");
    const evidenceContent = document.getElementById("nbaEvidenceContent");
    const evidenceBadge = document.getElementById("nbaEvidenceBadge");
    const finalContent = document.getElementById("nbaFinalContent");
    const sarBadge = document.getElementById("nbaSarBadge");

    if (!nba && !officialCase) {
      actionEl.textContent = "—";
      rationaleEl.textContent = "Select and run an investigation to determine optimal operational action.";
      authBadge.textContent = "AUTO";
      execStatus.textContent = "Not evaluated";
      return;
    }

    // Determine primary action and route
    const officialFinal = officialCase?.next_best_actions?.final;
    const primaryOfficialAction = officialFinal && officialFinal.length > 0 ? officialFinal[0] : null;
    const actionName = primaryOfficialAction ? primaryOfficialAction.action.replace(/_/g, " ") : (nba ? nba.actionType.replace(/_/g, " ") : "EVALUATED");
    const route = primaryOfficialAction ? primaryOfficialAction.route : (policyResult?.authorizationLevel || (nba ? nba.approvalRequired : "auto"));

    actionEl.textContent = actionName;
    rationaleEl.textContent = primaryOfficialAction ? primaryOfficialAction.reason : (nba ? nba.rationale : "Investigative recommendation derived from graph evidence.");

    authBadge.textContent = route.toUpperCase();
    if (policyTag && policyResult?.policyRuleTriggered) {
      policyTag.textContent = policyResult.policyRuleTriggered;
    }

    // Authorization Status
    const isExecuted = route === "auto" || policyResult?.executionStatus === "executed";
    if (isExecuted) {
      execStatus.textContent = "AUTOMATICALLY EXECUTED (AUTO)";
      execStatus.style.color = "var(--status-success)";
    } else {
      execStatus.textContent = `HUMAN APPROVAL REQUIRED (${route})`;
      execStatus.style.color = "var(--status-warning)";
    }

    if (approvalTitle) {
      approvalTitle.textContent = `OPERATIONAL GOVERNANCE (${route})`;
    }
    if (approvalDesc) {
      approvalDesc.textContent = isExecuted
        ? "Benign or low-risk non-destructive actions execute automatically without operational delay."
        : `Consequential actions (${actionName}) require ${route} human analyst authorization prior to terminal execution.`;
    }

    // Lifecycle breakdown from official case data
    if (officialCase?.next_best_actions) {
      // 1. Initial Recommendation
      const initials = officialCase.next_best_actions.initial || [];
      initialRoute.textContent = initials[0]?.route?.toUpperCase() || "AUTO";
      initialRoute.className = `route-pill ${initials[0]?.route || 'auto'}`;
      initialList.innerHTML = initials.map((act) => `
        <div class="nba-action-row">
          <span class="route-pill ${act.route}">${act.route}</span>
          <div>
            <strong>${act.action.replace(/_/g, " ")}</strong>
            <div class="sub-text">${act.reason}</div>
          </div>
        </div>
      `).join("");

      // 2. Evidence Verification
      const requests = officialCase.evidence_requests || [];
      if (requests.length > 0) {
        evidenceBadge.textContent = "DISPATCHED";
        evidenceBadge.className = "route-pill L1";
        evidenceContent.innerHTML = requests.map((req) => `
          <div>
            <div style="font-size:12px; font-weight:700; color:var(--text-primary);">Type: ${req.type.replace(/_/g, " ").toUpperCase()}</div>
            <div class="sub-text" style="margin-top:2px;">Dispatched after Step ${req.asked_after_step}</div>
            <div style="font-size:11.5px; color:#cbd5e1; margin-top:4px; font-style:italic;">Response: "${req.assumed_response}"</div>
          </div>
        `).join("");
      } else {
        evidenceBadge.textContent = "NOT REQUIRED";
        evidenceBadge.className = "route-pill auto";
        evidenceContent.innerHTML = `
          <div style="font-size:12px; font-weight:600; color:var(--text-secondary);">Additional Evidence: Not required</div>
          <div class="sub-text" style="margin-top:3px;">Sufficient graph topology and precedent evidence established.</div>
        `;
      }

      // 3. Final Recommendation & SAR
      const finals = officialCase.next_best_actions.final || [];
      const sar = officialCase.sar;
      if (sar && sar.file) {
        sarBadge.textContent = "SAR FILED";
        sarBadge.className = "route-pill sar-filed";
      } else {
        sarBadge.textContent = "NO SAR";
        sarBadge.className = "route-pill auto";
      }

      finalContent.innerHTML = `
        <div class="nba-item-list">
          ${finals.map((act) => `
            <div class="nba-action-row">
              <span class="route-pill ${act.route}">${act.route}</span>
              <div>
                <strong>${act.action.replace(/_/g, " ")}</strong>
                <div class="sub-text">${act.reason}</div>
              </div>
            </div>
          `).join("")}
        </div>
        <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px;">
          <span style="color:var(--text-muted);">What Changed:</span> <span style="color:var(--text-secondary);">${officialCase.next_best_actions.what_changed}</span>
        </div>
      `;
    }
  }

  function renderAuditTimeline(toolCalls, stopDecision, policyResult) {
    const timeline = document.getElementById("auditTimeline");
    timeline.innerHTML = "";

    if (!toolCalls || toolCalls.length === 0) {
      timeline.innerHTML = '<div class="empty-state">No investigation events logged.</div>';
      return;
    }

    toolCalls.forEach((tc) => {
      const parts = tc.split(":");
      const div = document.createElement("div");
      div.className = "audit-entry";
      div.innerHTML = `<span class="audit-ts">TOOL_CALL</span> <span class="audit-action">Executed controlled read tool: <strong>${parts[0]}</strong> (req: ${parts[1] || "default"})</span>`;
      timeline.appendChild(div);
    });

    // Add Graph Analytics & GraphRAG audit events
    const algoDiv = document.createElement("div");
    algoDiv.className = "audit-entry";
    algoDiv.innerHTML = `<span class="audit-ts">GRAPH_ALGO</span> <span class="audit-action">Executed topological graph algorithms: <strong>degree centrality, bridge detection, ring score</strong></span>`;
    timeline.appendChild(algoDiv);

    const ragDiv = document.createElement("div");
    ragDiv.className = "audit-entry";
    ragDiv.innerHTML = `<span class="audit-ts">GRAPHRAG</span> <span class="audit-action">Executed graph-grounded synthesis: <strong>bounded temporal subgraph facts</strong></span>`;
    timeline.appendChild(ragDiv);

    if (stopDecision) {
      const div = document.createElement("div");
      div.className = "audit-entry";
      div.innerHTML = `<span class="audit-ts">${stopDecision.evaluatedAt}</span> <span class="audit-action">Investigation Finalized: <strong>${stopDecision.reasonCode}</strong> (${stopDecision.rationale})</span>`;
      timeline.appendChild(div);
    }

    if (policyResult) {
      const div = document.createElement("div");
      div.className = "audit-entry";
      div.innerHTML = `<span class="audit-ts">GOVERNANCE</span> <span class="audit-action">Policy Evaluation: <strong>${policyResult.policyRuleTriggered}</strong> → ${policyResult.executionStatus === "executed" ? "Auto-Executed" : `Requires ${policyResult.authorizationLevel} Approval`}</span>`;
      timeline.appendChild(div);
    }
  }

  // Event listeners
  caseSelect.addEventListener("change", () => {
    const selectedCaseId = caseSelect.value;
    if (selectedCaseId) {
      localStorage.setItem(STORAGE_KEY_SELECTED_CASE, selectedCaseId);
      const url = new URL(window.location);
      url.searchParams.set("caseId", selectedCaseId);
      window.history.replaceState({}, "", url);
      // Option B: Selecting case prepares the trigger without auto-running investigation
      renderTriggerReadyState(selectedCaseId);
    }
  });

  runBtn.addEventListener("click", executeInvestigation);
  evidenceFilter.addEventListener("change", renderEvidenceTable);

  // Initialize: Load case list, restore active case, and present clean ready state (all blank until RUN clicked)
  loadCases().then((activeCaseId) => {
    if (activeCaseId) {
      localStorage.setItem(STORAGE_KEY_SELECTED_CASE, activeCaseId);
      renderTriggerReadyState(activeCaseId);
    }
  });
});



