import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro:content';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // Extend Starlight's docs schema with a `ribbonIcon` field — the id
      // of the in-app ribbon button this page documents. Picked up by
      // PageTitle.astro to stamp the icon next to the H1.
      extend: z.object({
        ribbonIcon: z.string().optional(),
      }),
    }),
  }),
};
