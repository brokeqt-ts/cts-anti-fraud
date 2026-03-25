export enum OFFER_VERTICAL {
  GAMBLING = 'gambling',
  NUTRA = 'nutra',
  CRYPTO = 'crypto',
  DATING = 'dating',
  SWEEPSTAKES = 'sweepstakes',
  ECOMMERCE = 'ecommerce',
  FINANCE = 'finance',
  OTHER = 'other',
}

export enum CAMPAIGN_TYPE {
  PMAX = 'pmax',
  SEARCH = 'search',
  DEMAND_GEN = 'demand_gen',
  UAC = 'uac',
  DISPLAY = 'display',
  SHOPPING = 'shopping',
  VIDEO = 'video',
  OTHER = 'other',
}

export enum BAN_TARGET {
  ACCOUNT = 'account',
  DOMAIN = 'domain',
  CAMPAIGN = 'campaign',
  AD = 'ad',
}

export enum APPEAL_STATUS {
  NOT_SUBMITTED = 'not_submitted',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum BROWSER_TYPE {
  ADSPOWER = 'adspower',
  DOLPHIN = 'dolphin',
  OCTO = 'octo',
  MULTILOGIN = 'multilogin',
  GOLOGIN = 'gologin',
  OTHER = 'other',
}

export enum PROXY_TYPE {
  RESIDENTIAL = 'residential',
  MOBILE = 'mobile',
  DATACENTER = 'datacenter',
  ISP = 'isp',
}

export enum PROXY_ROTATION {
  STICKY = 'sticky',
  ROTATING = 'rotating',
}

export enum PAYMENT_CARD_TYPE {
  DEBIT = 'debit',
  CREDIT = 'credit',
  PREPAID = 'prepaid',
  VIRTUAL = 'virtual',
}

export enum AI_PREDICTION_MODEL {
  CLAUDE = 'claude',
  GEMINI = 'gemini',
  OPENAI = 'openai',
}

export enum PREDICTION_TYPE {
  BAN_PROBABILITY = 'ban_probability',
  LIFETIME_PREDICTION = 'lifetime_prediction',
  RISK_SCORE = 'risk_score',
}

export enum VERIFICATION_STATUS {
  NOT_STARTED = 'not_started',
  PENDING = 'pending',
  VERIFIED = 'verified',
  FAILED = 'failed',
}

export enum ACCOUNT_STATUS {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BANNED = 'banned',
  UNDER_REVIEW = 'under_review',
}

export enum CAMPAIGN_STATUS {
  ACTIVE = 'active',
  PAUSED = 'paused',
  REMOVED = 'removed',
  PENDING = 'pending',
  DISAPPROVED = 'disapproved',
}

export enum SSL_TYPE {
  LETS_ENCRYPT = 'lets_encrypt',
  PAID = 'paid',
  NONE = 'none',
  UNKNOWN = 'unknown',
}

export enum DNS_PROVIDER {
  CLOUDFLARE = 'cloudflare',
  DIRECT = 'direct',
  OTHER = 'other',
}
