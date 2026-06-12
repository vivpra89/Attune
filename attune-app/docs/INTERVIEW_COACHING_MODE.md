# Interview Coaching Mode

## Overview

Interview Coaching Mode is an AI-powered feature that helps users prepare for technical interviews at top-tier companies (FAANG level). The AI acts as an interviewer, asking personalized questions based on the candidate's resume, job description, and projects, then provides detailed coaching feedback on each answer.

## Features

### 1. **Personalized Question Generation**
- Generates interview questions tailored to:
  - Interview type (Technical, Behavioral, System Design, Coding, Product Management, Program Management, General)
  - Candidate's resume/background
  - Target job description
  - Key projects
- Questions progress from easy to hard difficulty
- Cover multiple aspects of the interview type

### 2. **Speech-to-Text Answer Capture**
- Integrated with system audio capture
- Real-time transcription of spoken answers
- Natural conversation flow
- Start/stop controls for answer recording

### 3. **FAANG-Level Coaching Feedback**
After each answer, receive comprehensive feedback including:
- **Score (0-100)**: Quantitative assessment
- **Strengths**: What you did well
- **Improvements**: Areas to work on
- **FAANG Comparison**: How your answer compares to successful FAANG candidates
- **Suggested Answer**: A model FAANG-level answer
- **Next Steps**: Actionable advice to improve

### 4. **Session Management**
- Track progress through multiple questions
- Save and review past interview sessions
- Overall performance scoring
- Question-by-question breakdown

## User Flow

### Phase 1: Setup
1. Click "Interview Coach" button in the System Audio interface
2. Select interview type (Technical, Behavioral, System Design, Coding, Product Management, Program Management, or General)
3. (Optional) Paste resume/background information
4. (Optional) Paste job description for tailored questions
5. (Optional) Add key projects to discuss
6. Click "Start Interview"

### Phase 2: Interview
1. AI presents a question with context and difficulty level
2. Click "Start Speaking" to record your answer
3. Speak your answer naturally
4. Click "Stop Recording" when finished
5. Review your transcribed answer
6. Click "Get FAANG-Level Coaching"

### Phase 3: Coaching
1. Review your score and performance metrics
2. Read through strengths and areas for improvement
3. Study the FAANG benchmark comparison
4. Review the suggested model answer
5. Note the next steps for improvement
6. Click "Next Question" to continue

### Phase 4: Complete
1. View overall interview performance
2. Review question-by-question breakdown
3. Identify patterns in strengths and weaknesses
4. Start a new interview or end session

## Technical Architecture

### Components

#### `InterviewCoachingMode.tsx`
Main UI component managing the interview flow through all phases (setup, interview, coaching, complete).

**Key Features:**
- Multi-phase state management
- Question display and navigation
- Answer recording interface
- Feedback visualization
- Session completion summary

#### `InterviewCoachingWrapper.tsx`
Integration layer between Interview Coaching Mode and System Audio capture.

**Key Features:**
- Bridges speech recognition with coaching system
- Manages transcript accumulation
- Controls audio capture lifecycle
- Handles coaching callbacks

#### `InterviewCoachingButton.tsx`
Entry point component that launches the coaching interface in a dialog.

**Key Features:**
- Dialog-based modal interface
- Clean separation from main audio UI
- Easy access from system audio panel

### Hooks

#### `useInterviewCoaching.ts`
Core state management hook for interview coaching functionality.

**Responsibilities:**
- Session lifecycle management
- Question progression
- Answer submission and evaluation
- Feedback state management
- LocalStorage persistence

### API Functions

#### `interviewCoaching.ts`
AI integration layer for question generation and answer evaluation.

**Key Functions:**
- `generateInterviewQuestions()`: Creates personalized questions based on context
- `evaluateInterviewAnswer()`: Provides FAANG-level coaching feedback
- Integration with existing AI completion API

## AI Prompts

### Question Generation
The system uses carefully crafted prompts that:
- Define FAANG-level expectations
- Incorporate candidate context (resume, JD, projects)
- Specify difficulty progression
- Request structured JSON output
- Include category and key points for each question

### Answer Evaluation
Coaching prompts are designed to:
- Apply FAANG interview standards
- Compare to successful candidate responses
- Provide specific, actionable feedback
- Score on a calibrated 0-100 scale
- Generate natural, conversational model answers
- Suggest concrete improvement steps

## Data Storage

### LocalStorage Schema
```typescript
interface InterviewCoachingSession {
  id: string;
  type: InterviewType;
  resume?: string;
  jobDescription?: string;
  projects?: string[];
  currentQuestionIndex: number;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  overallScore: number;
  createdAt: number;
  updatedAt: number;
}
```

Sessions are stored in `localStorage` under the key `interview-coaching-sessions`. Only the most recent 20 sessions are kept to manage storage.

## Scoring System

### Score Ranges
- **90-100**: Exceptional - Strong hire at FAANG
- **80-89**: Strong answer - Likely hire
- **70-79**: Good answer with minor gaps
- **60-69**: Acceptable but needs improvement
- **Below 60**: Significant gaps, needs work

### Evaluation Criteria

#### Technical Interviews
- Technical accuracy and depth
- Problem-solving approach
- Communication of complex concepts
- Edge case consideration
- Code quality and best practices

#### Behavioral Interviews
- STAR method usage
- Leadership and impact
- Self-awareness and learning
- Collaboration skills
- Quantifiable results

#### System Design
- Requirements understanding
- Scalability considerations
- Trade-off analysis
- Component design
- Operational considerations

#### Coding Interviews
- Algorithm correctness
- Time/space complexity analysis
- Code clarity and structure
- Edge case handling
- Optimization awareness

#### Product Management Interviews
- Product sense and user empathy
- Data-driven decision making and metrics
- Strategic thinking and prioritization
- Stakeholder management and communication
- Technical understanding and trade-offs
- Execution and delivery focus

#### Program Management Interviews
- Cross-functional leadership and influence
- Risk identification and mitigation
- Stakeholder alignment and communication
- Timeline and resource management
- Process improvement and efficiency
- Conflict resolution and problem-solving

## Future Enhancements

### Potential Features
1. **Mock Interview Mode**: Full end-to-end interview simulation
2. **Weakness Training**: Focus on identified weak areas
3. **Company-Specific Prep**: Tailor to specific companies beyond FAANG
4. **Video Recording**: Practice on-camera presence
5. **Peer Comparison**: Anonymous benchmarking against other users
6. **Interview Calendar**: Schedule practice sessions
7. **Progress Tracking**: Long-term skill development tracking
8. **Follow-up Questions**: Dynamic probing based on initial answers
9. **Time Pressure Mode**: Practice with interview time constraints
10. **Team Interview Simulation**: Practice with multiple "interviewers"

## Usage Tips

### For Best Results
1. **Be Specific**: Provide detailed resume and JD for better question targeting
2. **Speak Naturally**: Practice conversational delivery
3. **Take Feedback Seriously**: Review the suggested answers carefully
4. **Iterate**: Do multiple sessions to track improvement
5. **Cover All Types**: Practice different interview types
6. **Time Yourself**: Be aware of answer length
7. **Note Patterns**: Identify recurring weaknesses
8. **Apply Learnings**: Use "Next Steps" advice between sessions

### Common Pitfalls
- Speaking too fast or unclearly
- Rambling without structure
- Ignoring the key points hint
- Not reviewing feedback thoroughly
- Skipping the suggested answer
- Not practicing weak areas identified

## Troubleshooting

### AI Not Generating Questions
- Check AI provider configuration
- Verify API credentials in settings
- Ensure stable internet connection
- Try with simpler input (resume only)

### Speech Recognition Issues
- Verify microphone permissions
- Check system audio setup
- Adjust VAD sensitivity if needed
- Speak clearly and at moderate pace

### Coaching Feedback Errors
- Ensure answer has sufficient content
- Check AI provider quota/limits
- Verify network connectivity
- Try shorter, more focused answers

## Privacy & Data

### Data Handling
- All sessions stored locally in browser
- Resume/JD data never leaves your device except for AI processing
- No permanent server-side storage
- Sessions can be deleted anytime

### AI Processing
- Interview data sent to configured AI provider
- Follows same privacy policy as other AI features
- No data used for model training (provider-dependent)

## Integration Points

The Interview Coaching Mode integrates with:
- System Audio capture system
- Speech-to-text transcription
- AI completion API
- LocalStorage for persistence
- Existing UI component library

## Code Organization

```
src/
├── pages/app/components/speech/
│   ├── InterviewCoachingMode.tsx      # Main UI component
│   ├── InterviewCoachingWrapper.tsx   # Integration layer
│   └── InterviewCoachingButton.tsx    # Entry point
├── hooks/
│   └── useInterviewCoaching.ts        # State management hook
└── lib/
    └── interviewCoaching.ts           # AI integration functions
```

## Contributing

When extending the Interview Coaching Mode:
1. Maintain separation of concerns (UI, state, AI integration)
2. Follow existing TypeScript patterns
3. Update this documentation
4. Add fallback behavior for AI failures
5. Consider mobile/small screen layouts
6. Test with various interview types
7. Validate input edge cases

## License

Part of the Attune application.
