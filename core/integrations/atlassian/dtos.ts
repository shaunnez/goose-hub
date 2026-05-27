import { z } from 'zod';

export const AtlassianProviderSchema = z.enum(['jira', 'bitbucket']);
export const AtlassianTierSchema = z.enum(['headline', 'card', 'detail', 'evidence']);
export const AtlassianResourceKindSchema = z.enum(['issue', 'pull_request']);

export const AtlassianArtifactRefSchema = z
  .object({
    artifactKey: z.string().min(1),
    kind: z.string().min(1),
    summary: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    stored: z.literal(true),
  })
  .strict();

const AssigneeSchema = z
  .object({
    displayName: z.string().min(1),
    accountId: z.string().min(1).optional(),
    emailAddress: z.string().min(1).optional(),
  })
  .strict();

export const AtlassianHeadlineSchema = z
  .object({
    provider: AtlassianProviderSchema,
    resourceKind: AtlassianResourceKindSchema,
    tier: z.literal('headline'),
    id: z.string().min(1),
    key: z.string().min(1).optional(),
    title: z.string().min(1),
    status: z.string().min(1),
    url: z.string().url(),
    totalCount: z.number().int().nonnegative().optional(),
    hasMore: z.boolean().optional(),
  })
  .strict();

export const AtlassianCardSchema = AtlassianHeadlineSchema.extend({
  tier: z.literal('card'),
  project: z.string().min(1).optional(),
  issueType: z.string().min(1).optional(),
  repoRef: z.string().min(1).optional(),
  assignee: AssigneeSchema.optional(),
  priority: z.string().min(1).optional(),
  created: z.string().min(1).optional(),
  updated: z.string().min(1).optional(),
}).strict();

export const AtlassianDetailSchema = AtlassianCardSchema.extend({
  tier: z.literal('detail'),
  bodyPreview: z.string().optional(),
  bodyArtifactRef: AtlassianArtifactRefSchema.optional(),
  rawArtifactRef: AtlassianArtifactRefSchema.optional(),
  labels: z.array(z.string()).default([]),
  components: z.array(z.string()).default([]),
  linkedKeys: z.array(z.string()).default([]),
}).strict();

export const AtlassianEvidenceSchema = z
  .object({
    provider: AtlassianProviderSchema,
    resourceKind: AtlassianResourceKindSchema,
    tier: z.literal('evidence'),
    id: z.string().min(1),
    key: z.string().min(1).optional(),
    url: z.string().url(),
    commentsSummary: z.string().optional(),
    historySummary: z.string().optional(),
    attachmentSummaries: z.array(z.string()).default([]),
    artifactRefs: z.array(AtlassianArtifactRefSchema).default([]),
  })
  .strict();

export const JiraIssueHeadlineSchema = AtlassianHeadlineSchema.extend({
  provider: z.literal('jira'),
  resourceKind: z.literal('issue'),
}).strict();

export const JiraIssueCardSchema = AtlassianCardSchema.extend({
  provider: z.literal('jira'),
  resourceKind: z.literal('issue'),
}).strict();

export const JiraIssueDetailSchema = AtlassianDetailSchema.extend({
  provider: z.literal('jira'),
  resourceKind: z.literal('issue'),
}).strict();

export const BitbucketPullRequestHeadlineSchema = AtlassianHeadlineSchema.extend({
  provider: z.literal('bitbucket'),
  resourceKind: z.literal('pull_request'),
}).strict();

export const BitbucketPullRequestCardSchema = AtlassianCardSchema.extend({
  provider: z.literal('bitbucket'),
  resourceKind: z.literal('pull_request'),
}).strict();

export const BitbucketPullRequestDetailSchema = AtlassianDetailSchema.extend({
  provider: z.literal('bitbucket'),
  resourceKind: z.literal('pull_request'),
}).strict();

export type AtlassianProvider = z.infer<typeof AtlassianProviderSchema>;
export type AtlassianTier = z.infer<typeof AtlassianTierSchema>;
export type AtlassianArtifactRef = z.infer<typeof AtlassianArtifactRefSchema>;
export type AtlassianHeadlineDto = z.infer<typeof AtlassianHeadlineSchema>;
export type AtlassianCardDto = z.infer<typeof AtlassianCardSchema>;
export type AtlassianDetailDto = z.infer<typeof AtlassianDetailSchema>;
export type AtlassianEvidenceDto = z.infer<typeof AtlassianEvidenceSchema>;
export type JiraIssueHeadlineDto = z.infer<typeof JiraIssueHeadlineSchema>;
export type JiraIssueCardDto = z.infer<typeof JiraIssueCardSchema>;
export type JiraIssueDetailDto = z.infer<typeof JiraIssueDetailSchema>;
export type BitbucketPullRequestHeadlineDto = z.infer<typeof BitbucketPullRequestHeadlineSchema>;
export type BitbucketPullRequestCardDto = z.infer<typeof BitbucketPullRequestCardSchema>;
export type BitbucketPullRequestDetailDto = z.infer<typeof BitbucketPullRequestDetailSchema>;
