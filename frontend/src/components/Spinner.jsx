/**
 * Spinner.jsx
 * -----------
 * Centred full-area loading indicator.
 *
 * @param {object} props
 * @param {string} [props.label="Loading…"] – accessible screen-reader text
 * @param {'sm'|'md'|'lg'} [props.size='md']
 */
export default function Spinner({ label = 'Loading…', size = 'md' }) {
  const sz = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' }[size]

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3" role="status">
      <svg
        className={`${sz} animate-spin text-indigo-500`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12" cy="12" r="10"
          stroke="currentColor" strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="text-sm text-gray-500">{label}</span>
    </div>
  )
}
