// Clip data layer
// For hackathon: uses seed data. In production: hits Twitch API.

export interface Clip {
  id: string
  title: string
  channel: string
  game: string
  duration: number  // seconds
  view_count: number
  created_at: string
  thumbnail_url: string
  embed_url: string
  download_url: string
  creator_wallet?: string  // streamer's Tempo wallet for revenue share
}

// Seed data - realistic Twitch clips
const CLIPS: Clip[] = [
  {
    id: 'clip_001',
    title: 'INSANE 1v5 ACE',
    channel: 'shroud',
    game: 'Valorant',
    duration: 28,
    view_count: 1_250_000,
    created_at: '2026-03-19T10:30:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip001/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=InsaneAce-shroud',
    download_url: 'https://clips-media.twitch.tv/InsaneAce-shroud.mp4',
  },
  {
    id: 'clip_002',
    title: 'chat made him lose it 💀',
    channel: 'xqc',
    game: 'Just Chatting',
    duration: 45,
    view_count: 890_000,
    created_at: '2026-03-19T08:15:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip002/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=ChatMadeHim-xqc',
    download_url: 'https://clips-media.twitch.tv/ChatMadeHim-xqc.mp4',
  },
  {
    id: 'clip_003',
    title: 'perfectly timed donation',
    channel: 'pokimane',
    game: 'Just Chatting',
    duration: 15,
    view_count: 2_100_000,
    created_at: '2026-03-19T14:20:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip003/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=PerfectDono-poki',
    download_url: 'https://clips-media.twitch.tv/PerfectDono-poki.mp4',
  },
  {
    id: 'clip_004',
    title: 'the luckiest smoke kill ever',
    channel: 'summit1g',
    game: 'CS2',
    duration: 22,
    view_count: 670_000,
    created_at: '2026-03-18T22:45:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip004/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=SmokeKill-summit',
    download_url: 'https://clips-media.twitch.tv/SmokeKill-summit.mp4',
  },
  {
    id: 'clip_005',
    title: 'NO WAY THAT JUST HAPPENED',
    channel: 'timthetatman',
    game: 'Fortnite',
    duration: 35,
    view_count: 450_000,
    created_at: '2026-03-19T16:00:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip005/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=NoWay-tim',
    download_url: 'https://clips-media.twitch.tv/NoWay-tim.mp4',
  },
  {
    id: 'clip_006',
    title: 'rank 1 any% speedrun strat',
    channel: 'shroud',
    game: 'Valorant',
    duration: 60,
    view_count: 780_000,
    created_at: '2026-03-19T11:00:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip006/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=Rank1-shroud',
    download_url: 'https://clips-media.twitch.tv/Rank1-shroud.mp4',
  },
  {
    id: 'clip_007',
    title: 'emotional moment with chat',
    channel: 'pokimane',
    game: 'Just Chatting',
    duration: 90,
    view_count: 1_500_000,
    created_at: '2026-03-18T20:30:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip007/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=Emotional-poki',
    download_url: 'https://clips-media.twitch.tv/Emotional-poki.mp4',
  },
  {
    id: 'clip_008',
    title: 'accidentally showed DMs on stream',
    channel: 'xqc',
    game: 'Just Chatting',
    duration: 12,
    view_count: 3_200_000,
    created_at: '2026-03-19T09:00:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip008/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=DMs-xqc',
    download_url: 'https://clips-media.twitch.tv/DMs-xqc.mp4',
  },
  {
    id: 'clip_009',
    title: 'world record deagle shot',
    channel: 'summit1g',
    game: 'CS2',
    duration: 18,
    view_count: 920_000,
    created_at: '2026-03-19T01:15:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip009/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=Deagle-summit',
    download_url: 'https://clips-media.twitch.tv/Deagle-summit.mp4',
  },
  {
    id: 'clip_010',
    title: 'destroyed by a default skin',
    channel: 'timthetatman',
    game: 'Fortnite',
    duration: 25,
    view_count: 380_000,
    created_at: '2026-03-19T15:30:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip010/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=Default-tim',
    download_url: 'https://clips-media.twitch.tv/Default-tim.mp4',
  },
  {
    id: 'clip_011',
    title: 'outplayed the whole server',
    channel: 'shroud',
    game: 'Valorant',
    duration: 40,
    view_count: 1_100_000,
    created_at: '2026-03-18T19:00:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip011/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=Outplayed-shroud',
    download_url: 'https://clips-media.twitch.tv/Outplayed-shroud.mp4',
  },
  {
    id: 'clip_012',
    title: 'reading the most insane sub message',
    channel: 'xqc',
    game: 'Just Chatting',
    duration: 55,
    view_count: 1_800_000,
    created_at: '2026-03-19T12:45:00Z',
    thumbnail_url: 'https://picsum.photos/seed/clip012/480/272',
    embed_url: 'https://clips.twitch.tv/embed?clip=SubMessage-xqc',
    download_url: 'https://clips-media.twitch.tv/SubMessage-xqc.mp4',
  },
]

export function getClips(opts: { sort?: string; limit?: number; channel?: string }): Clip[] {
  let clips = [...CLIPS]

  if (opts.channel) {
    clips = clips.filter(c => c.channel.toLowerCase() === opts.channel!.toLowerCase())
  }

  if (opts.sort === 'trending' || opts.sort === 'views') {
    clips.sort((a, b) => b.view_count - a.view_count)
  } else if (opts.sort === 'recent') {
    clips.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  return clips.slice(0, opts.limit || 10)
}

export function searchClips(query: string, limit: number = 10): Clip[] {
  const q = query.toLowerCase()
  return CLIPS
    .filter(c => 
      c.title.toLowerCase().includes(q) ||
      c.channel.toLowerCase().includes(q) ||
      c.game.toLowerCase().includes(q)
    )
    .slice(0, limit)
}

export function getClipById(id: string): Clip | undefined {
  return CLIPS.find(c => c.id === id)
}
