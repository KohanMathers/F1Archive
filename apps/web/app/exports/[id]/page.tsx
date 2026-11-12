import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DataSection } from '@/components/DataNav';
import { Title } from '@/components/marks';
import { Status } from './Status';

export const metadata: Metadata = { title: 'Export', robots: { index: false } };

export default async function ExportJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  return (
    <DataSection current="/research">
      <Title sub="This page’s address is how you get back to the export. It is kept for 48 hours after it finishes.">Export</Title>
      <Status id={id} />
    </DataSection>
  );
}
