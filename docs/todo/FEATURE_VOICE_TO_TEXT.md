# Voice-to-Text for Chat Input

## Overview

Add voice-to-text capability to the chat input box that understands technical/engineering terminology, symbols, and references to code context (e.g., table names, function names, file paths).

## Problem Statement

Typing technical content with symbols, code references, and specific terminology can be tedious. Voice input could speed up communication, but standard speech-to-text struggles with:
- Technical terminology (e.g., "PostgreSQL", "useEffect", "kubectl")
- Code symbols (e.g., "public.anime", "src/components/Chat.vue")
- Programming concepts (e.g., "async/await", "React.useState")
- Context-aware references (e.g., "the table public.anime" should preserve the dot notation)

## User's Example

> "for the table public.anime, do such and such"

Expected text output: `for the table public.anime, do such and such`

Challenge: How to communicate "public.anime" (with the dot) via voice so it's accurately transcribed?

## Research: Existing Solutions

### 1. **Google Cloud Speech-to-Text API**
- What CUI likely uses
- Features:
  - Custom vocabulary/phrase hints
  - Context-aware recognition
  - Punctuation auto-formatting
  - Supports technical terms via phrase hints
- Pricing: $0.006 per 15 seconds (first 60 min/month free)
- API: REST or gRPC streaming

### 2. **OpenAI Whisper API**
- Open-source model, also available as API
- Very good at technical content
- Can use prompts to guide transcription
- Pricing: $0.006 per minute
- Known for better handling of technical terms than Google

### 3. **Web Speech API (Browser Native)**
- Free, built into modern browsers
- Uses Google's speech recognition backend
- No custom vocabulary support
- **Browser Support:** ⚠️ **Chromium-based only** (Chrome, Edge, Opera)
  - ❌ Not supported in Firefox
  - ❌ Not supported in Safari
  - ✅ Works in Chrome/Edge/Brave/Opera
- **Pros:** Zero cost, no API keys needed
- **Cons:**
  - Less accurate for technical terms
  - Privacy concerns (uses Google backend)
  - Limited browser support (~65% of desktop users)

### 4. **Azure Speech Service**
- Custom speech models
- Phrase lists for domain-specific terms
- Real-time transcription
- Similar pricing to Google

## Proposed Solution

### Option A: Hybrid Approach (⚠️ Limited Browser Support)

**Browser Web Speech API + Context-Aware Post-Processing**

1. **Use Web Speech API for initial transcription** (free, no API keys)
2. **Post-process with context awareness:**
   - Extract technical terms from current project context:
     - Database table names (from schema if available)
     - File paths from current project
     - Function/class names from codebase
     - Common programming terms
   - Use fuzzy matching to correct transcription errors
   - Preserve symbols based on context (dots, underscores, slashes)

**Example Flow:**
```
Voice: "for the table public anime do such and such"
↓ Web Speech API
Text: "for the table public anime do such and such"
↓ Context-aware post-processing (knows about public.anime table)
Final: "for the table public.anime, do such and such"
```

**Pros:**
- Free
- No API keys required
- Works offline (after initial load)
- Privacy-preserving (browser-only processing)
- Can leverage project context

**Cons:**
- ❌ **Only works in Chromium browsers** (Chrome, Edge, Brave, Opera)
- ❌ **No Firefox or Safari support**
- Less accurate than commercial APIs
- Requires building context extraction system
- May need user corrections
- Privacy concerns (uses Google's backend despite being "browser-native")

### Option B: OpenAI Whisper API

**Use Whisper API with custom prompts**

1. Record audio in browser
2. Send to Whisper API with context prompt:
   ```
   Prompt: "This is a technical conversation about software development.
   Context: Database tables include public.anime, public.users.
   Preserve dots, underscores, and slashes in technical terms."
   ```
3. Whisper transcribes with context awareness

**Pros:**
- Very accurate for technical content
- Handles symbols better
- Can use prompts for context

**Cons:**
- Costs money ($0.006/min)
- Requires API key configuration
- Privacy concerns (audio sent to OpenAI)
- Requires internet connection

### Option C: Google Speech-to-Text with Phrase Hints

**Use Google Cloud Speech-to-Text API**

1. Extract technical terms from project context
2. Send as phrase hints: `["public.anime", "src/components", "async/await"]`
3. Google uses hints to improve accuracy

**Pros:**
- Commercial-grade accuracy
- First 60 min/month free
- Good technical term support

**Cons:**
- Requires Google Cloud setup
- API key management
- Costs after free tier
- Privacy concerns

## Technical Implementation (Option A - Recommended)

### Architecture

```
┌─────────────────┐
│   Chat Input    │
│  ┌───────────┐  │
│  │ 🎤 Record │  │ ← User clicks mic button
│  └───────────┘  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ Web Speech API          │
│ (Browser Native)        │
│ - Start recognition     │
│ - Stream interim results│
│ - Get final transcript  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Context Extraction      │
│ - Get table names       │
│ - Get file paths        │
│ - Get function names    │
│ - Programming keywords  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Post-Processing         │
│ - Fuzzy match terms     │
│ - Add symbols (. _ /)   │
│ - Format code blocks    │
│ - Add punctuation       │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Insert into Chat Input  │
│ (User can edit)         │
└─────────────────────────┘
```

### UI/UX Design

**Chat Input Enhancement:**
```
┌────────────────────────────────────────┐
│  Type your message...                  │
│                                        │
│  [symbols] [📎] [🎤]      [Send]      │
└────────────────────────────────────────┘
              ↑
         Voice button
```

**Recording State:**
```
┌────────────────────────────────────────┐
│  🔴 Recording... (Tap to stop)         │
│  "for the table public anime..."       │
│                                        │
│  [symbols] [📎] [⏹️]      [Send]      │
└────────────────────────────────────────┘
          Interim results shown
```

**Post-Processing Confirmation:**
```
┌────────────────────────────────────────┐
│  for the table public.anime, do such   │
│  and such                              │
│                           ⚠️ Review    │
│  [symbols] [📎] [🎤]      [Send]      │
└────────────────────────────────────────┘
          Yellow indicator = AI-corrected
```

### Code Structure

**New Files:**
```
src/composables/useSpeechToText.js
  - useWebSpeechAPI() - Browser API integration
  - useContextExtraction() - Get project context
  - useTranscriptPostProcessing() - Correct technical terms

src/utils/speechContext.js
  - extractDatabaseTables()
  - extractFilePaths()
  - extractFunctionNames()
  - fuzzyMatchTechnicalTerm()
```

**Modified Files:**
```
src/views/ChatView.vue
  - Add mic button
  - Add recording state UI
  - Integrate speech-to-text composable
```

### Context Extraction Strategy

**1. Database Tables** (if MCP or schema available):
```javascript
// Extract from MCP tools or schema
const tables = ['public.anime', 'public.users', 'public.ratings'];
```

**2. File Paths** (from current project):
```javascript
// From files mode or recent file edits
const filePaths = [
  'src/components/ChatView.vue',
  'server/events/terminal.js',
  'package.json'
];
```

**3. Programming Keywords**:
```javascript
const programmingTerms = [
  'async/await', 'try/catch', 'import/export',
  'React.useState', 'Vue.ref', 'console.log',
  'npm install', 'git commit', 'docker run'
];
```

**4. Recent Chat History**:
```javascript
// Extract technical terms from last 5 messages
const recentTerms = extractFromMessages(messages.slice(-5));
```

### Post-Processing Algorithm

```javascript
function postProcessTranscript(rawText, context) {
  let processed = rawText;

  // 1. Fuzzy match database tables
  for (const table of context.tables) {
    const fuzzyPattern = table.replace(/\./g, ' ');
    if (processed.includes(fuzzyPattern)) {
      processed = processed.replace(fuzzyPattern, table);
    }
  }

  // 2. Fix file paths (add slashes)
  processed = processed.replace(
    /src components (\w+)/gi,
    'src/components/$1'
  );

  // 3. Add dots for method calls
  processed = processed.replace(
    /(\w+) (useState|useEffect|ref|computed)/gi,
    '$1.$2'
  );

  // 4. Add common punctuation
  processed = addSmartPunctuation(processed);

  return processed;
}
```

## User Workflow

### Happy Path
1. User clicks 🎤 mic button
2. Recording starts (red indicator)
3. User speaks: "for the table public anime, add a column for rating"
4. Interim results shown in real-time
5. User stops recording
6. System post-processes:
   - Detects "public anime" → corrects to "public.anime" (from context)
   - Adds comma after "public.anime"
7. Final text appears in input: `for the table public.anime, add a column for rating`
8. User reviews, edits if needed, sends

### Edge Cases
1. **Unknown term:** User can manually edit or add to project dictionary
2. **Ambiguous:** Show suggestions: "Did you mean: public.anime or publicAnime?"
3. **Complex code:** For code blocks, suggest switching to text input
4. **Noisy environment:** Show confidence score, allow retry

## Configuration

**Settings Modal:**
```javascript
{
  voiceInput: {
    enabled: true,
    autoInsert: true, // Insert immediately vs. review first
    showConfidence: true, // Show AI correction warnings
    language: 'en-US', // Browser language
    contextSources: ['database', 'files', 'chat'], // What to use for context
  }
}
```

## Privacy Considerations

**Option A (Web Speech API):**
- Audio processed by browser (uses Google's cloud service)
- Transcript stays local
- Context extraction happens locally
- No data sent to our servers

**Option B/C (Commercial APIs):**
- Audio sent to third-party API
- Must inform users
- Allow opt-in/opt-out
- Consider on-device models (Whisper.cpp)

## Challenges & Open Questions

### 1. Symbol Disambiguation
**Problem:** How to voice "public.anime" vs "public anime"?

**Potential Solutions:**
- **Context-based:** If "public.anime" exists in DB, auto-correct
- **Voice commands:** User says "dot" → inserted as `.`
- **Post-recording edit:** User clicks word to toggle symbols
- **Visual confirmation:** Highlight AI-corrected terms in yellow

### 2. Code Block Detection
**Problem:** How to know user wants a code block vs. prose?

**Solutions:**
- Magic words: "code block" → wrap in ```
- Detect programming keywords
- Post-recording: "Convert to code block?" button

### 3. Accuracy for Non-English Names
**Problem:** "PostgreSQL", "Kubernetes", "nginx" may be mis-transcribed

**Solutions:**
- Build large technical dictionary
- Learn from user corrections
- Allow custom pronunciations

### 4. Real-time Feedback
**Problem:** Should we show interim results during recording?

**Options:**
- Show raw interim (may be messy)
- Show post-processed interim (lag)
- Only show final (no feedback)

## Implementation Phases

### Phase 1: MVP (Web Speech API)
- [ ] Add mic button to chat input
- [ ] Integrate Web Speech API
- [ ] Basic recording UI
- [ ] Insert transcript to input
- [ ] No post-processing yet

### Phase 2: Context Extraction
- [ ] Extract file paths from project
- [ ] Extract recent chat terms
- [ ] Build programming keywords dictionary
- [ ] Integrate with MCP for DB schema (if available)

### Phase 3: Post-Processing
- [ ] Fuzzy matching for technical terms
- [ ] Symbol correction (dots, slashes)
- [ ] Smart punctuation
- [ ] Visual indicators for AI corrections

### Phase 4: Advanced Features
- [ ] Voice commands ("dot", "slash", "underscore")
- [ ] Code block detection
- [ ] Multi-language support
- [ ] User dictionary / corrections learning

### Phase 5 (Optional): Commercial API
- [ ] OpenAI Whisper integration
- [ ] Google Speech-to-Text integration
- [ ] API key configuration
- [ ] Cost tracking

## Success Metrics

- **Adoption:** % of messages sent via voice
- **Accuracy:** % of transcripts requiring no edits
- **Speed:** Time saved vs. typing
- **User Satisfaction:** Survey responses

## Alternatives Considered

1. **No voice input:** Users type everything (current state)
2. **Simple dictation:** No context, user fixes everything manually
3. **AI autocomplete:** Instead of voice, suggest completions (different feature)
4. **Hybrid voice + autocomplete:** Voice activates, autocomplete helps fix

## Recommendation

**⚠️ UPDATED: Option B or C (Commercial API) is now recommended**

**Rationale:**
- Web Speech API has limited browser support (Chromium only)
- ~35% of users (Firefox, Safari) would be excluded
- For a developer tool, broad compatibility is important
- Commercial APIs work across all browsers
- Cost is minimal ($0.006/min = $0.36/hour)
- Better accuracy for technical terms

**Recommended Approach: OpenAI Whisper API (Option B)**

**Why Whisper:**
- Works in all browsers (just uses fetch API)
- Very accurate for technical content
- Can use prompts to guide transcription with project context
- Affordable ($0.006/min)
- Easy to implement (record audio → send blob → get transcript)
- No infrastructure setup (unlike Google Cloud)

**Alternative: Start with Web Speech API, offer Whisper as premium**
- Free tier: Web Speech API (Chromium only)
- Premium/fallback: Whisper API (all browsers)
- Let users choose based on browser and preference

**Next Steps:**
1. Build Phase 1 MVP with Whisper API
2. Add optional Web Speech API for Chromium users (faster, free)
3. Test with real usage patterns
4. Gather feedback on accuracy
5. Iterate on context-aware prompting

## Questions for Discussion

1. **Privacy:** Comfortable with browser-based speech recognition (uses Google backend)?
2. **Accuracy threshold:** What % accuracy is acceptable before needing commercial API?
3. **Voice commands:** Should "dot", "slash" be reserved words to insert symbols?
4. **UI placement:** Mic button in chat input vs. floating button vs. keyboard shortcut?
5. **Mobile:** How important is mobile support (different browser capabilities)?
6. **Multilingual:** Need support for non-English languages?
7. **Code focus:** Should we optimize for code-heavy conversations vs. general chat?

## Related Features

- Code completion (autocomplete)
- Slash commands (related to voice commands)
- Chat history search (leverage for context)
- MCP integration (for database schema context)

## Browser Compatibility

### Web Speech API Support (as of 2026)

| Browser | Desktop | Mobile | Notes |
|---------|---------|--------|-------|
| Chrome | ✅ Yes | ✅ Yes | Full support since v25 |
| Edge | ✅ Yes | ✅ Yes | Chromium-based, full support |
| Brave | ✅ Yes | ✅ Yes | Chromium-based, full support |
| Opera | ✅ Yes | ✅ Yes | Chromium-based, full support |
| Firefox | ❌ No | ❌ No | No support, no plans |
| Safari | ❌ No | ❌ No | No support |

**Market Share Impact:**
- Chrome + Edge + Brave + Opera ≈ **65%** of desktop users
- Firefox + Safari ≈ **35%** of desktop users
- **Conclusion:** 1 in 3 users would not have access to Web Speech API

### Commercial API Support (Whisper/Google)

| Browser | Desktop | Mobile | Notes |
|---------|---------|--------|-------|
| All modern browsers | ✅ Yes | ✅ Yes | Uses standard fetch API |

**Compatibility:** Works everywhere with internet connection

## Resources

- [Web Speech API Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text)
- [Browser Compatibility - Web Speech API](https://caniuse.com/speech-recognition)
- [StatCounter Browser Market Share](https://gs.statcounter.com/browser-market-share)
