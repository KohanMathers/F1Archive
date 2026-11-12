export function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="8.5" cy="8.5" r="5.75" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="search-field">
      <SearchIcon />
      <input type="search" {...props} />
    </span>
  );
}
