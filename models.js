// Katalog model AI + biaya kredit + pemetaan ke APIframe.
// Frontend mengambilnya lewat GET /api/models.
//
// apiframeModel : nilai field "model" di POST /v2/music/generate
// modelVersion  : sunoParams.model_version (khusus keluarga Suno)
export const MODELS = [
  { id: "kie-suno-v5.5",        label: "KIE AI Suno V5.5",     credits: 11, provider: "kie",      modelVersion: "V5_5" },
  { id: "kie-suno-v5",          label: "KIE AI Suno V5",       credits: 11, provider: "kie",      modelVersion: "V5" },
  { id: "musicapi-sonic-v4.5",  label: "MusicAPI Sonic V4.5", credits: 11, provider: "musicapi", modelVersion: "sonic-v4-5" },
  { id: "musicapi-sonic-v4",    label: "MusicAPI Sonic V4",   credits: 11, provider: "musicapi", modelVersion: "sonic-v4" },
  { id: "crun-suno-v5.5",       label: "crun.ai Suno V5.5",    credits: 11, provider: "crun",     modelVersion: "v5.5" },
  { id: "crun-suno-v5",         label: "crun.ai Suno V5",      credits: 11, provider: "crun",     modelVersion: "v5" },
  { id: "crun-suno-v4.5-plus",  label: "crun.ai Suno V4.5 Plus", credits: 11, provider: "crun",   modelVersion: "v4.5plus" },
  { id: "crun-suno-v4.5",       label: "crun.ai Suno V4.5",    credits: 11, provider: "crun",     modelVersion: "v4.5" },
  { id: "suno-v5.5",            label: "Suno V5.5",            credits: 11, apiframeModel: "suno",     modelVersion: "V5_5" },
  { id: "suno-v4.5-plus",       label: "Suno V4.5 Plus",       credits: 11, apiframeModel: "suno",     modelVersion: "V4_5PLUS" },
  { id: "suno-v5",             label: "Suno V5",              credits: 11, apiframeModel: "suno",     modelVersion: "V5" },
  { id: "suno-v4.5",           label: "Suno V4.5",            credits: 11, apiframeModel: "suno",     modelVersion: "V4_5" },
  { id: "suno-v4",             label: "Suno V4",              credits: 11, apiframeModel: "suno",     modelVersion: "V4" },
  { id: "lyria-3-pro",         label: "Lyria 3 Pro",          credits: 14, apiframeModel: "lyria" },
  { id: "lyria-3-clip",        label: "Lyria 3 Clip",         credits: 7,  apiframeModel: "lyria" },
  { id: "producer-fuzz-2-pro", label: "Producer FUZZ 2 Pro",  credits: 6,  apiframeModel: "producer" },
  { id: "producer-fuzz-2",     label: "Producer FUZZ 2",      credits: 6,  apiframeModel: "producer" },
  { id: "udio",               label: "Udio",                 credits: 9,  apiframeModel: "udio" },
]

export function getModel(id) {
  return MODELS.find((m) => m.id === id)
}
