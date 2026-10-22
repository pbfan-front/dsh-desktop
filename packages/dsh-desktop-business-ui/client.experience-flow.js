window.__ModuleLoader__.load({
  id: 'dsh-desktop-business-ui', chunk: 'client.experience-flow.js',
  factory: require => {
    const React = require('react')
    const routePath = value => {
      if (typeof value !== 'string') return ''
      const hash = value.indexOf('#')
      const route = (hash < 0 ? value : value.slice(hash + 1)).split('?')[0]
      return route.startsWith('/') && !route.startsWith('//') ? route.replace(/\/$/, '') || '/' : ''
    }
    const sessionOf = run => run?.context?.sessionId || ''

    /**
     * Current-conversation controller. Only an explicit click can approve a
     * versioned proposal. Passive checks send a saved stepId to the original
     * checkpoint; observation metadata is only a wake-up, never page proof.
     * No navigation, activation, source write, polling or automatic retry of
     * an unchanged failure is performed here.
     */
    function createExperienceController({ bridge, sessionId, currentSession, visible, proposalFor, progressFor,
      choicesFor, onChange, setTimer = setTimeout, clearTimer = clearTimeout, delay = 700 }) {
      let active = true, run, evidence, timer, busy = '', error = '', errorKind = '', attempted = ''
      const pendingEvents = []
      let loading = true
      const eligible = () => active && currentSession() === sessionId && visible()
      const progress = () => progressFor(run)
      const phase = () => {
        if (!run) return 'empty'
        if (busy === 'create') return 'creating'
        if (busy === 'check') return 'checking'
        if (proposalFor(run)) return 'confirm'
        if (choicesFor(run).length) return 'choosePage'
        if (run.status === 'completed') return 'verified'
        if (run.status === 'cancelled') return 'cancelled'
        const created = run.steps?.some(step => step.id === 'create-profile' && step.status === 'completed')
        if (!created) return run.status === 'failed' ? 'failed' : 'preparing'
        if (run.status === 'failed') return 'checkFailed'
        const check = progress()
        if (run.context?.experienceFlowVersion !== 1 || !check?.waiting || !check.next) return 'created'
        if (!evidence || evidence.profileId !== run.context.profileId) return 'selectBranch'
        const first = run.context.previewVerifications?.[0]?.result
        if (first && (first.revisionId !== evidence.revisionId || first.revision !== evidence.revision)) return 'restartChecks'
        if (routePath(evidence.route) !== routePath(check.next.route)) return 'openPage'
        return errorKind === 'check' ? 'checkPending' : 'checkingSoon'
      }
      const publish = () => { if (active) onChange({ run, loading, busy, error, errorKind, phase: phase(), progress: progress() }) }
      const accept = value => {
        if (!active || !value || value.workflowId !== 'business-scenario-create' || sessionOf(value) !== sessionId) return
        if (run?.id === value.id && (String(value.updatedAt) < String(run.updatedAt)
          || ['completed', 'cancelled'].includes(run.status) && !['completed', 'cancelled'].includes(value.status))) return
        if (!run || value.id === run.id || String(value.createdAt) > String(run.createdAt)) {
          const changed = run?.id !== value.id || run?.checkpointProposal?.id !== value.checkpointProposal?.id
          run = value
          if (changed) { error = ''; errorKind = '' }
          publish()
          schedule()
        }
      }
      const clear = () => { if (timer !== undefined) clearTimer(timer); timer = undefined }
      const checkable = () => {
        const check = progress()
        if (!eligible() || busy || run?.context?.experienceFlowVersion !== 1 || !check?.waiting || !check.next
          || run.compatibility?.status === 'incompatible' || !evidence || evidence.sessionId !== sessionId
          || evidence.profileId !== run.context.profileId || routePath(evidence.route) !== routePath(check.next.route)) return null
        const previous = run.context.previewVerifications?.at(-1)?.result
        if (previous && (previous.revisionId !== evidence.revisionId || previous.revision !== evidence.revision
          || Date.parse(evidence.observedAt) < Date.parse(previous.checkedAt))) return null
        return check.next
      }
      function schedule() {
        clear()
        const next = checkable()
        if (!next) return
        const key = JSON.stringify([run.id, next.id, evidence.fingerprint])
        if (attempted === key) return
        timer = setTimer(() => { timer = undefined; void verify(key) }, delay)
      }
      async function verify(key) {
        const next = checkable()
        if (!next || key !== JSON.stringify([run.id, next.id, evidence.fingerprint])) return
        attempted = key
        busy = 'check'; error = ''; errorKind = ''; publish()
        try {
          const value = await bridge.resumeBusinessWorkflow(run.id, { stepId: next.id })
          if (active) accept(value.run)
        } catch (failure) {
          if (active) { error = String(failure); errorKind = 'check' }
        } finally { busy = ''; publish(); if (active) schedule() }
      }
      async function action(kind, expectedRunId, expectedProposalId, selectedRoute) {
        if (!eligible() || busy || !run || run.id !== expectedRunId || run.compatibility?.status === 'incompatible') return
        const proposal = proposalFor(run)
        if (kind === 'create' && (!proposal || proposal.id !== expectedProposalId)) {
          errorKind = 'changed'; error = ''; publish(); return
        }
        if (kind === 'route' && !choicesFor(run).some(choice => choice.routePath === selectedRoute)) return
        if (kind === 'restart' && (!progress()?.waiting || phase() !== 'restartChecks')) return
        busy = kind; error = ''; errorKind = ''; clear(); publish()
        try {
          const value = kind === 'create' ? await bridge.approveBusinessWorkflowProposal(run.id, { proposalId: proposal.id, sessionId })
            : kind === 'route' ? await bridge.retryBusinessWorkflow(run.id, { selectedRoutePath: selectedRoute, confirmedByUser: true })
              : await bridge.resumeBusinessWorkflow(run.id, { restartVerification: true })
          if (active) { attempted = ''; accept(value.run) }
        } catch (failure) {
          if (active) { error = String(failure); errorKind = kind }
        } finally { busy = ''; publish(); if (active) schedule() }
      }
      const unsubscribeRun = bridge.onBusinessWorkflowChanged?.(value => {
        if (sessionOf(value) !== sessionId) return
        if (loading) { pendingEvents.push(value); if (pendingEvents.length > 64) pendingEvents.shift() }
        else accept(value)
      })
      const unsubscribeEvidence = bridge.onBusinessPreviewEvidence?.(value => {
        if (!active || value?.sessionId !== sessionId || !/^[a-f0-9]{64}$/.test(value.fingerprint || '')
          || !Number.isSafeInteger(value.revision) || typeof value.revisionId !== 'string'
          || !Number.isFinite(Date.parse(value.observedAt))
          || evidence && Date.parse(value.observedAt) < Date.parse(evidence.observedAt)) return
        evidence = value; publish(); schedule()
      })
      Promise.resolve().then(() => bridge.businessWorkflowRuns(sessionId)).then(value => {
        if (!active) return
        // Install the initial snapshot before newer events; never let a late
        // list response restore an old proposal after creation/cancellation.
        for (const item of [...(value?.runs || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) accept(item)
        for (const item of pendingEvents.splice(0)) accept(item)
        loading = false; publish()
      }).catch(failure => { if (active) { loading = false; error = String(failure); errorKind = 'load'; publish() } })
      return {
        confirm: (runId, proposalId) => action('create', runId, proposalId),
        chooseRoute: (runId, route) => action('route', runId, undefined, route),
        restart: runId => action('restart', runId),
        retry: () => { if (!eligible() || busy) return; attempted = ''; error = ''; errorKind = ''; publish(); schedule() },
        visibilityChanged: () => { if (!visible()) clear(); else schedule() },
        dispose: () => { active = false; clear(); pendingEvents.length = 0; unsubscribeRun?.(); unsubscribeEvidence?.() }
      }
    }

    function installStyles() {
      if (document.getElementById('dsh-business-experience-flow-styles')) return
      const style = document.createElement('style')
      style.id = 'dsh-business-experience-flow-styles'
      style.textContent = `
        .dshExperienceFlow{box-sizing:border-box;min-width:0;width:100%;padding:14px 16px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;overflow-wrap:anywhere}
        .dshExperienceFlow header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dshExperienceFlow h3{font-size:14px;line-height:1.5;font-weight:600;margin:0}.dshExperienceFlow p{margin:6px 0;color:var(--dsw-alias-label-secondary)}
        .dshExperienceFlow .dshExperienceState{font-size:12px;flex:none;color:var(--dsw-alias-label-secondary)}.dshExperienceFlow .dshExperienceActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px}
        .dshExperienceFlow button{min-height:44px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;cursor:pointer;background:transparent;color:inherit;font:inherit;transition:opacity 150ms}
        .dshExperienceFlow button[data-primary]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent;font-weight:500}.dshExperienceFlow button[data-secondary]{border-color:transparent;color:var(--dsw-alias-label-secondary)}
        .dshExperienceFlow button:hover:not(:disabled){opacity:.8}.dshExperienceFlow button:disabled{opacity:.5;cursor:default}.dshExperienceFlow :is(button,select,summary):focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill);outline-offset:3px}
        .dshExperienceFlow details{margin-top:8px}.dshExperienceFlow summary{min-height:32px;cursor:pointer;color:var(--dsw-alias-label-secondary)}.dshExperienceFlow .dshExperienceDetails{max-height:240px;overflow:auto;padding:4px 2px;font-size:12px}.dshExperienceFlow pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
        .dshExperienceFlow label{display:grid;gap:6px;margin-top:8px}.dshExperienceFlow select{min-height:44px;width:100%;max-width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;padding:8px;font:inherit}.dshExperienceFlow .dshExperienceNotice{font-size:12px}
        @media(prefers-reduced-motion:reduce){.dshExperienceFlow button{transition:none}}
        @media(max-width:440px){.dshExperienceFlow{padding:12px}.dshExperienceFlow header{flex-wrap:wrap}.dshExperienceFlow .dshExperienceActions button[data-primary]{width:100%}}
      `
      document.head.appendChild(style)
    }

    function BusinessExperienceDock({ sessionId, bridge, hostWindow, proposalFor, progressFor, choicesFor, t, openPreview, openDiagnostics }) {
      const [state, setState] = React.useState({ run: null, phase: 'empty', loading: true, busy: '', error: '', errorKind: '' })
      const [route, setRoute] = React.useState('')
      const controller = React.useRef()
      React.useEffect(() => {
        installStyles()
        if (!sessionId || !bridge?.businessWorkflowRuns) return undefined
        const instance = createExperienceController({ bridge, sessionId, proposalFor, progressFor, choicesFor,
          currentSession: () => hostWindow.document.documentElement.dataset.dshBusinessSessionId || '',
          visible: () => !hostWindow.document.hidden, onChange: setState })
        controller.current = instance
        const visibility = () => instance.visibilityChanged()
        hostWindow.document.addEventListener('visibilitychange', visibility)
        return () => { instance.dispose(); hostWindow.document.removeEventListener('visibilitychange', visibility); controller.current = undefined }
      }, [sessionId, bridge, hostWindow])
      const run = state.run
      React.useEffect(() => setRoute(''), [run?.id])
      if (run && sessionOf(run) !== sessionId || !run && !state.error) return null
      const proposal = proposalFor(run), plan = proposal?.output
      const choices = choicesFor(run)
      const busy = Boolean(state.busy)
      const compatible = run?.compatibility?.status !== 'incompatible'
      const title = plan?.label || run?.context?.plan?.label || t('dailyTitle')
      const page = run?.context?.target?.pageTitle || run?.context?.analysis?.route?.title || run?.context?.targetPage
      const humanHint = state.errorKind === 'changed' ? 'dailyChanged' : state.error && !['check', 'load'].includes(state.errorKind)
        ? 'dailyActionFailed' : `dailyHint_${state.phase}`
      return React.createElement('section', { className: 'dshExperienceFlow', 'aria-label': t('dailyTitle'), 'aria-busy': busy },
        React.createElement('header', null, React.createElement('h3', null, title),
          React.createElement('span', { className: 'dshExperienceState' }, t(`dailyState_${state.phase}`))),
        React.createElement('p', { role: 'status', 'aria-live': 'polite' }, t(state.errorKind === 'load' ? 'dailyLoadFailed' : humanHint)),
        !compatible && React.createElement('p', null, t('incompatibleHint')),
        plan && React.createElement(React.Fragment, null,
          page && React.createElement('p', null, page),
          run.context?.analysis?.analysisPlan?.qualityGate?.level === 'review' && React.createElement('p', { className: 'dshExperienceNotice' }, t('dailyReviewNotice')),
          React.createElement('details', null, React.createElement('summary', null, t('dailyDetails')),
            React.createElement('div', { className: 'dshExperienceDetails' },
              React.createElement('p', null, t('planReviewHint')),
              React.createElement('ul', null, plan.scenarios.map(item => React.createElement('li', { key: item.id }, item.apiUrl, ' — ', item.sourceScenarioId || t('planData')))),
              React.createElement('ol', null, plan.verificationSteps?.map(step => React.createElement('li', { key: step.id },
                React.createElement('strong', null, step.label), React.createElement('div', null, step.route),
                React.createElement('div', null, t('previewRequired'), ': ', step.containsText.join('、')),
                step.absentText.length > 0 && React.createElement('div', null, t('previewForbidden'), ': ', step.absentText.join('、'))))),
              React.createElement('details', null, React.createElement('summary', null, t('planFull')), React.createElement('pre', null, JSON.stringify(plan, null, 2)))))),
        choices.length > 0 && React.createElement('label', null, t('chooseRoute'),
          React.createElement('select', { value: route, disabled: busy, onChange: event => setRoute(event.target.value) },
            React.createElement('option', { value: '' }, t('dailyChoosePage')),
            choices.map(choice => React.createElement('option', { key: choice.routePath, value: choice.routePath }, `${choice.pageTitle || ''} ${choice.routePath}`)))),
        ['openPage', 'checkingSoon', 'checkPending', 'checking'].includes(state.phase) && state.progress?.next
          && React.createElement('p', null, state.progress.next.label),
        state.error && React.createElement('details', null, React.createElement('summary', null, t('dailyTechnicalDetails')),
          React.createElement('pre', { className: 'dshExperienceDetails' }, state.error)),
        React.createElement('div', { className: 'dshExperienceActions' },
          plan && React.createElement('button', { type: 'button', 'data-primary': true, disabled: busy || !compatible,
            onClick: () => controller.current?.confirm(run.id, proposal.id) }, t(state.busy === 'create' ? 'planCreating' : 'planConfirm')),
          choices.length > 0 && React.createElement('button', { type: 'button', 'data-primary': true, disabled: busy || !route || !compatible,
            onClick: () => controller.current?.chooseRoute(run.id, route) }, t('confirmRoute')),
          state.phase === 'restartChecks' && React.createElement('button', { type: 'button', disabled: busy || !compatible,
            onClick: () => controller.current?.restart(run.id) }, t('dailyRestartChecks')),
          state.phase === 'checkPending' && React.createElement('button', { type: 'button', disabled: busy,
            onClick: () => controller.current?.retry() }, t('dailyRetryCheck')),
          !plan && choices.length === 0 && React.createElement('button', { type: 'button', 'data-secondary': true, onClick: openPreview }, t('dailyOpenPreview')),
          React.createElement('button', { type: 'button', 'data-secondary': true, onClick: openDiagnostics }, t('dailyDiagnostics'))))
    }

    return { createExperienceController, BusinessExperienceDock }
  }
})
