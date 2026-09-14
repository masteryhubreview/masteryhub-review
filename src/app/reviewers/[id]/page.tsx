import ReviewerEditorPage from '@/components/admin/ReviewerEditorPage';

export default async function EditReviewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ReviewerEditorPage reviewerId={id} />;
}
