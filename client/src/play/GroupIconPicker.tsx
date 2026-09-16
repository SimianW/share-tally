import { Notification } from './Notification';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { GroupIconView } from './GroupIconView';
import { isUnicodeIcon, type GroupIcon } from './group-icon';
import { iconLabel, lucideChoices, type IconChoice } from './icon-catalog';

export default function GroupIconPicker({ value, onApply, onCancel }: {
  value: GroupIcon; onApply: (value: GroupIcon) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [label, setLabel] = useState(iconLabel(value));
  const [source, setSource] = useState(value.type);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [limit, setLimit] = useState(48);
  const [emojis, setEmojis] = useState<IconChoice[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    if (source !== 'unicode' || emojis) return;
    let active = true;
    import('./emoji-catalog').then(({ emojiChoices }) => {
      if (active) { setEmojis(emojiChoices); setLoadError(false); }
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [source, emojis, retry]);

  const results = useMemo(() => {
    const words = query.toLowerCase().trim().replaceAll('-', ' ').split(/\s+/);
    return (source === 'lucide' ? lucideChoices : emojis ?? []).filter(item =>
      words.every(word => item.keywords.toLowerCase().includes(word)));
  }, [source, emojis, query]);
  const invalidCustom = custom !== '' && !isUnicodeIcon(custom);
  function resetResults() { setLimit(48); resultsRef.current?.scrollTo(0, 0); }
  function changeSource(next: GroupIcon['type']) {
    setSource(next); setCustom(''); resetResults(); searchRef.current?.focus();
  }
  function choose(item: IconChoice) { setDraft(item.icon); setLabel(item.label); setCustom(''); }

  return <section className="group-icon-picker" aria-labelledby={`${id}-title`}>
    <header className="picker-heading">
      <div><span className="eyebrow">CHOOSE AN ICON</span><h2 id={`${id}-title`}>What feels like you?</h2></div>
      <button type="button" className="icon-button" aria-label="Close icon picker" onClick={onCancel}><X size={20} /></button>
    </header>
    <div className="picker-search">
      <Search size={19} aria-hidden="true" />
      <input ref={searchRef} aria-label="Search icons and emoji" value={query}
        placeholder={source === 'lucide' ? 'Search icons… coffee, travel, 咖啡' : 'Search emoji… pizza, smile, 购物'}
        onChange={event => { setQuery(event.target.value); resetResults(); }} />
      {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); resetResults(); searchRef.current?.focus(); }}><X size={16} /></button>}
    </div>
    <div className="picker-sources" role="group" aria-label="Icon source">
      <button type="button" aria-pressed={source === 'lucide'} onClick={() => changeSource('lucide')}>Icons <span>{lucideChoices.length}</span></button>
      <button type="button" aria-pressed={source === 'unicode'} onClick={() => changeSource('unicode')}>Emoji {emojis && <span>{emojis.length}</span>}</button>
    </div>
    <div className="picker-results" ref={resultsRef}>
      <div className="picker-results-heading"><span>{query ? `Results for “${query}”` : 'Explore the library'}</span><span role="status">{source === 'unicode' && !emojis ? '' : `${results.length} found`}</span></div>
      {source === 'unicode' && !emojis ? loadError ? <Notification title="Could not load emoji">Could not load the emoji library. You can still paste one below.<button type="button" onClick={() => { setLoadError(false); setRetry(value => value + 1); }}>Try again</button></Notification> : <p role="status">Loading emoji…</p> : <>
        <div className="picker-grid" role="group" aria-label="Search results">
          {results.slice(0, limit).map(item => <button type="button" key={`${item.icon.type}:${item.icon.value}`}
            aria-label={`Select ${item.label}`} title={item.label}
            aria-pressed={draft.type === item.icon.type && draft.value === item.icon.value}
            onClick={() => choose(item)}>
            <GroupIconView icon={item.icon} size={28} />
            {draft.type === item.icon.type && draft.value === item.icon.value && <Check className="picker-check" size={13} aria-hidden="true" />}
          </button>)}
        </div>
        {!results.length && <p className="picker-message">No matches. Try a different word{source === 'unicode' ? ' or paste an emoji below' : ''}.</p>}
        {results.length > limit && <button type="button" className="picker-more" onClick={() => setLimit(value => value + 48)}>Show more <ChevronDown size={16} /></button>}
      </>}
    </div>
    {source === 'unicode' && <div className="picker-custom">
      <label htmlFor={`${id}-custom`}>Or paste any emoji / symbol</label>
      <input id={`${id}-custom`} aria-label="Paste emoji or symbol" placeholder="👨‍👩‍👧‍👦" value={custom}
        aria-invalid={invalidCustom} aria-describedby={invalidCustom ? `${id}-error` : undefined}
        onChange={event => {
          const value = event.target.value; setCustom(value);
          if (isUnicodeIcon(value)) { setDraft({ type: 'unicode', value }); setLabel(value); }
        }} />
      {invalidCustom && <div id={`${id}-error`}><Notification title="Check your icon">Enter one visible character or emoji. Combined emoji are supported.</Notification></div>}
    </div>}
    <footer className="picker-selection">
      <span className="picker-selected-art"><GroupIconView icon={draft} size={28} /></span>
      <div aria-live="polite"><small>SELECTED</small><strong>{label}</strong></div>
      <button type="button" disabled={invalidCustom} onClick={() => onApply(draft)}>Use icon <Check size={17} /></button>
    </footer>
  </section>;
}
