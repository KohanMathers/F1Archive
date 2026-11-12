import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DataSection } from '@/components/DataNav';
import { Title } from '@/components/marks';
import { Tables } from './Tables';

export const metadata: Metadata = { title: 'Tables', description: 'Read the archive’s tables row by row: laps, results, weather, race control, team radio, stints and telemetry.' };

export default function TablesPage() {
  return (
    <DataSection current="/data">
      <Title sub="The same columns as the exports and the API. Hover a column name for its meaning and unit.">Tables</Title>
      <Suspense fallback={<div className="skel" />}>
        <Tables />
      </Suspense>
    </DataSection>
  );
}
