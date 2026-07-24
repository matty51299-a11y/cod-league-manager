// Derives the exact data shapes the ported v0 panels expect, from the real
// game state — read-only. No sim/save/roster/calendar logic lives here; this
// only reads state already produced by src/store + src/engine and reshapes
// it for display, the same way src/components/HistoricalDashboard.jsx does
// for the screen this page is modeled on.
import { resolveUserTeamMeta } from '../utils/userTeam.js'
import { getEra } from '../data/codEras.js'
import { getUnreadCount, getActionRequiredCount } from '../engine/eventCentreEngine.js'
import { isInteractiveCircuitEvent } from '../engine/circuitTournament.js'

function ordinal(n) {
  const v = Number(n)
  if (!v) return '—'
  const s = ['th', 'st', 'nd', 'rd']
  const m = v % 100
  return v + (s[(m - 20) % 10] || s[m] || s[0])
}

const EVENT_TYPE_LABEL = {
  ONLINE_2K: 'Online 2K',
  ONLINE_5K: 'Online 5K',
  ONLINE_CUP: 'Online Cup',
  OPEN_LAN: 'Open LAN',
  LEAGUE_SEASON: 'League',
  WORLD_CHAMPIONSHIP: 'Championship',
  INVITATIONAL: 'Invitational',
  REGIONAL_CHAMPIONSHIP: 'Regional',
}

function money(n) {
  return n ? `$${Number(n).toLocaleString('en-US')}` : null
}

function recentKd(playerId, playerSeasonStats, season) {
  if (!playerId || !playerSeasonStats || season == null) return null
  const rows = (playerSeasonStats[playerId] || []).filter(
    (r) => Number(r.season) === Number(season) && (r.matches || 0) > 0,
  )
  if (!rows.length) return null
  const kills = rows.reduce((sum, r) => sum + (r.kills || 0), 0)
  const deaths = rows.reduce((sum, r) => sum + (r.deaths || 0), 0)
  return deaths > 0 ? kills / deaths : kills > 0 ? kills : 1
}

function formBucket(form) {
  const v = Number(form) || 0
  if (v >= 60) return 'good'
  if (v >= 40) return 'ok'
  return 'bad'
}

const TIER_FALLBACK = 'C'

// Pre-existing bug (not introduced here, not touched per "don't modify
// save-game logic"): gameStore.jsx's LOAD_GAME reducer collapses
// state.userTeamType to "cdl" on any reload of a Historical Dynasty save
// (it only preserves "challenger", never "historical" — reproduces on the
// main app too with a plain browser refresh, unrelated to this page). Since
// resolveUserTeamMeta() trusts that flag, it falls back to a generic
// "Historical Team" object once the flag is wrong. This page hits that path
// on every visit because it's a full page navigation. Worked around locally
// here by resolving straight from state.teams (unaffected by the bug) when
// userTeamId looks historical, before falling back to the shared helper.
function resolveHistoricalOrUserTeamMeta(state) {
  if (String(state.userTeamId || '').startsWith('historical:')) {
    const t = (state.teams || []).find((x) => x.id === state.userTeamId)
    if (t) {
      const tag = String(t.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'HST'
      return { id: t.id, name: t.name, tag, color: '#fbbf24', logo: null, region: t.region || null }
    }
  }
  return resolveUserTeamMeta(state)
}

export function useDashboardData(state) {
  if (!state) return null

  const userTeamId = state.userTeamId
  const team = resolveHistoricalOrUserTeamMeta(state)
  const era = getEra(state.currentEraId)
  const oc = state.openCircuit
  const season = state.season

  const roster = (state.players || [])
    .filter((p) => p.teamId === userTeamId && !p.isSub)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0))
  const teamOvr = roster.length
    ? Math.round(roster.reduce((s, p) => s + (p.overall || 0), 0) / roster.length)
    : null

  const ranking = oc?.ranking || []
  const userRank = ranking.find((r) => r.teamId === userTeamId)
  const results = oc?.results || {}
  const all = oc?.calendar?.all || []
  const nextEventRaw = oc && !oc.seasonComplete
    ? all.find((e) => e.id === oc.nextEventId) || all.find((e) => !results[e.id])
    : null

  const userEvents = Object.entries(results)
    .map(([id, r]) => {
      if (!r || r.skipped || !r.userInField) return null
      return {
        id,
        name: r.name,
        startDate: r.startDate,
        rank: r.userPlacement,
        eventType: r.eventType,
        points: r.userPoints || 0,
        prize: r.userPrize || 0,
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))

  const wins = userEvents.filter((e) => e.rank === 1).length
  const podiums = userEvents.filter((e) => e.rank <= 3).length

  const stats = [
    {
      label: 'Pro Points Rank',
      value: userRank ? ordinal(userRank.rank) : '—',
      sub: ranking.length ? `/ ${ranking.length}` : '',
      tone: userRank && userRank.rank <= 8 ? 'good' : 'neutral',
    },
    {
      label: 'Pro Points',
      value: userRank ? Number(userRank.points).toLocaleString() : '0',
      sub: '',
      tone: 'neutral',
    },
    { label: 'Team OVR', value: teamOvr ?? '—', sub: '', tone: 'good' },
    { label: 'Event Wins', value: wins, sub: '', tone: wins ? 'good' : 'neutral' },
    { label: 'Podiums', value: podiums, sub: '', tone: 'neutral' },
    {
      label: 'Season Progress',
      value: String(oc?.playedCount ?? 0),
      sub: `/ ${oc?.totalEvents ?? all.length ?? 0}`,
      tone: 'neutral',
    },
  ]

  const nextEvent = nextEventRaw
    ? {
        id: nextEventRaw.id,
        name: nextEventRaw.name,
        typeLabel: EVENT_TYPE_LABEL[nextEventRaw.eventType] || nextEventRaw.eventType,
        tier: nextEventRaw.tier || TIER_FALLBACK,
        date: nextEventRaw.startDate,
        field: nextEventRaw.targetFieldSize,
        prize: money(nextEventRaw.prizePool),
        location: nextEventRaw.location,
        interactive: isInteractiveCircuitEvent(nextEventRaw.eventType),
      }
    : null

  const fixtures = all
    .filter((e) => !results[e.id])
    .slice(0, 6)
    .map((e) => ({
      id: e.id,
      date: e.startDate,
      name: e.name,
      tier: e.tier || TIER_FALLBACK,
      type: EVENT_TYPE_LABEL[e.eventType] || e.eventType,
      next: e.id === nextEventRaw?.id,
    }))

  const proPoints = ranking.slice(0, 10).map((r) => ({
    pos: r.rank,
    team: r.name,
    pts: Number(r.points) || 0,
    you: r.teamId === userTeamId,
  }))

  const squad = roster.slice(0, 4).map((p) => {
    const kd = recentKd(p.id, state.playerSeasonStats, season)
    return {
      id: p.id,
      name: p.name,
      role: p.primary || 'Flex',
      ovr: p.overall || 0,
      kd,
      form: formBucket(p.form),
    }
  })

  const feedTeaser = [...(state.feed ?? [])].reverse().slice(0, 3)
  const teamNews = feedTeaser.map((item) => ({
    tag: (item.type || item.phase || 'NEWS').toString().toUpperCase().slice(0, 8),
    text: item.message || item.body || item.title || '',
  }))

  const seasonResults = userEvents.slice(0, 8).map((e) => ({
    id: e.id,
    date: e.startDate,
    name: e.name,
    typeLabel: EVENT_TYPE_LABEL[e.eventType] || e.eventType,
    rank: e.rank,
    points: e.points,
    prize: money(e.prize),
  }))

  return {
    userTeamId,
    team,
    era,
    seasonComplete: !!oc?.seasonComplete,
    hasOpenCircuit: !!oc && !oc.error,
    stats,
    nextEvent,
    fixtures,
    proPoints,
    squad,
    teamNews,
    seasonResults,
    unreadInbox: getUnreadCount(state.eventCentre),
    actionRequired: getActionRequiredCount(state.eventCentre),
  }
}
