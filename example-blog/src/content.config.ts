import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: image().optional(),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      tags: z.array(z.string()).optional(),
      readingMinutes: z.coerce.number().optional(),
      brandColor: z.string().optional(),
      coverAssetPath: z.string().optional(),
    }),
});

const project = defineCollection({
  loader: glob({ base: './src/content/project', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      order: z.coerce.number().default(100),
      showDemoInline: z.boolean().default(false),
      demoOrientation: z.enum(['portrait', 'landscape']).default('landscape'),
      screenshots: z.array(image()).optional(),
      thumbnail: image().optional(),
      tags: z.array(z.string()).optional(),
      demoUrl: z.string().optional(),
      repoUrl: z.string().optional(),
      isFeatured: z.boolean().default(false),
      accentColor: z.string().optional(),
      cardImagePath: z.string().optional(),
    }),
});

const snippet = defineCollection({
  loader: glob({ base: './src/content/snippet', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      language: z.enum(['ts', 'js', 'go', 'rust', 'bash']),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date().optional(),
      minutes: z.coerce.number().default(5),
      difficulty: z
        .enum(['beginner', 'intermediate', 'advanced'])
        .default('beginner'),
      draft: z.boolean().default(false),
      tags: z.array(z.string()).default([]),
      thumbnail: image().optional(),
      hexColor: z.string().optional(),
      previewPath: z.string().optional(),
      galleryPaths: z.array(z.string()).optional(),
    }),
});

export const collections = { blog, project, snippet };
