// PROTOTYPE ONLY (#94): renders the chosen group-page layout with real data.
/* eslint-disable react-refresh/only-export-components -- throwaway prototype helpers */
import { useEffect, useState, type ReactNode } from 'react';
import type { BillApi } from '../bill-api';
import { RecordRepayment } from '../Repayments';
import { groupView, type PageData } from './group-view';
import { currentLayout } from './layout-choice';
import type { LayoutProps } from './parts';
import { ColumnLayout } from './ColumnLayout';
import { SidebarLayout } from './SidebarLayout';
import { HeroLayout } from './HeroLayout';
import { BoardLayout } from './BoardLayout';
import { TableLayout } from './TableLayout';
import './prototype-layout.css';

const views: Record<string, (props: LayoutProps) => ReactNode> = {
  column: ColumnLayout, sidebar: SidebarLayout, hero: HeroLayout, board: BoardLayout, table: TableLayout,
};

export function useLayout() {
  const [layout, setLayout] = useState(currentLayout);
  useEffect(() => {
    const update = () => setLayout(currentLayout());
    window.addEventListener('prototype-layout', update);
    return () => window.removeEventListener('prototype-layout', update);
  }, []);
  return layout;
}

export function GroupPagePrototype({ layout, data, groupId, api, title, drafts, records, openMembers, refresh }: {
  layout: string; data: PageData; groupId: string; api: BillApi; title: ReactNode;
  drafts: ReactNode; records: ReactNode; openMembers: () => void; refresh: () => void;
}) {
  const [recording, setRecording] = useState<{ prefill?: { recipientId: string; amountCents: number } } | null>(null);
  const View = views[layout];
  return <div className={`gp gp-${layout}`}>
    <View view={groupView(data)} group={data.group} title={title} drafts={drafts} records={records}
      openMembers={openMembers}
      newBill={() => { window.location.hash = `/new-bill/${groupId}`; }}
      record={prefill => setRecording({ prefill })}
      review={repaymentId => { window.location.hash = `/group-bills/${groupId}?repayment=${repaymentId}`; }} />
    {recording && <RecordRepayment group={data.group} api={api} initial={recording.prefill}
      close={() => setRecording(null)} saved={() => { setRecording(null); refresh(); }} />}
  </div>;
}
