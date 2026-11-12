import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DataSection } from '@/components/DataNav';
import { Title } from '@/components/marks';
import { Builder } from './Builder';

export const metadata: Metadata = {
  title: 'Export builder',
  description: 'Build a dataset from any seasons, sessions and drivers and download it as CSV, JSON Lines, JSON, Parquet or SQLite.',
};

export default function ExportPage() {
  return (
    <DataSection current="/research">
      <Title sub="Exports are built in the background and contain original-resolution data, a README, a schema with units for every column, and a provenance record. A request that is too large is refused with the reason and a suggested split; it is never cut short.">
        Export builder
      </Title>
      <Suspense fallback={<div className="skel" />}>
        <Builder />
      </Suspense>
    </DataSection>
  );
}
