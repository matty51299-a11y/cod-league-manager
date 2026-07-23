// Ported verbatim from the v0 project's components/manager/data.ts (TS types stripped only).
import {
  Home,
  Inbox,
  Trophy,
  CalendarDays,
  Crosshair,
  Users,
  Activity,
  Briefcase,
  Search,
  ArrowLeftRight,
  Target,
  FileBarChart,
  UserCog,
  ScrollText,
  Rss,
} from 'lucide-react'

export const navItems = [
  { label: 'Home', icon: Home, active: true },
  { label: 'Inbox', icon: Inbox, badge: 2 },
  { label: 'Standings', icon: Trophy },
  { label: 'Schedule', icon: CalendarDays },
  { label: 'K/D Leaders', icon: Crosshair },
  { label: 'Roster', icon: Users },
  { label: 'Dynamics', icon: Activity },
  { label: 'Board', icon: Briefcase },
  { label: 'Scouting', icon: Search },
  { label: 'Transfers', icon: ArrowLeftRight },
  { label: 'Circuit', icon: Target },
  { label: 'Dev Report', icon: FileBarChart },
  { label: 'Staff', icon: UserCog },
  { label: 'Match Log', icon: ScrollText },
  { label: 'Feed', icon: Rss },
]

export const stats = [
  { label: 'Pro Points Rank', value: '9th', sub: '/ 28', tone: 'warn' },
  { label: 'Pro Points', value: '0', sub: '', tone: 'neutral' },
  { label: 'Team OVR', value: '84', sub: '', tone: 'good' },
  { label: 'Event Wins', value: '0', sub: '', tone: 'neutral' },
  { label: 'Podiums', value: '0', sub: '', tone: 'neutral' },
  { label: 'Season Progress', value: '0', sub: '/ 81', tone: 'neutral' },
]

export const proPoints = [
  { pos: 1, team: 'Aztek Gaming', pts: 0 },
  { pos: 2, team: 'compLexity', pts: 0 },
  { pos: 3, team: 'Envy', pts: 0 },
  { pos: 4, team: 'Epsilon Esports', pts: 0 },
  { pos: 5, team: 'FaZe Clan', pts: 0 },
  { pos: 6, team: 'KILLERFISH eSport', pts: 0 },
  { pos: 7, team: 'Lightning Pandas', pts: 0 },
  { pos: 8, team: 'New Star Player', pts: 0 },
  { pos: 9, team: 'OpTic Gaming', pts: 0, you: true },
  { pos: 10, team: 'Real AllStars', pts: 0 },
]

export const fixtures = [
  { date: '23 Aug', name: 'Astro CoD: Ghosts Cup', tier: 'B', type: 'Open LAN', next: true },
  { date: '07 Sep', name: 'MLG 2K Series #4', tier: 'C', type: 'Online 2K' },
  { date: '21 Sep', name: 'UMG Online 5K', tier: 'B', type: 'Online 5K' },
  { date: '12 Oct', name: 'EGL 11', tier: 'A', type: 'Open LAN' },
  { date: '09 Nov', name: 'MLG Columbus', tier: 'S', type: 'Major LAN' },
  { date: '14 Dec', name: 'Gfinity G3', tier: 'A', type: 'Open LAN' },
]

export const roster = [
  { name: 'NaDeSHoT', role: 'AR / IGL', ovr: 87, kd: 1.14, form: 'good' },
  { name: 'Scumper', role: 'Sub / Flex', ovr: 84, kd: 1.02, form: 'ok' },
  { name: 'MErK', role: 'AR Anchor', ovr: 86, kd: 1.09, form: 'good' },
  { name: 'ProoFy', role: 'Objective', ovr: 82, kd: 0.98, form: 'bad' },
]

export const teamNews = [
  { tag: 'BOARD', text: 'Board expects a top-8 finish across the Open Circuit season.' },
  { tag: 'MEDIA', text: 'Analysts rank OpTic 9th going into Ghosts season openers.' },
  { tag: 'SQUAD', text: "ProoFy's confidence is low after limited scrim minutes." },
]
