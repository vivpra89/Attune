import { PageLayout } from "@/layouts";
import { InterviewTypePicker } from "./components";

const Dashboard = () => {
  return (
    <PageLayout
      title="Dashboard"
      description="Quick settings for how Attune answers during interviews and conversations."
    >
      <InterviewTypePicker />
    </PageLayout>
  );
};

export default Dashboard;
