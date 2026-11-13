import Link from 'next/link';

// A trail at the top of a page: every item but the last is a link back up. The last is where you are.
//   <Breadcrumb items={[{ label: 'Jobs', href: '/jobs' }, { label: 'Job #12' }]} />
export default function Breadcrumb({ items }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${it.label}-${i}`}>
              {last || !it.href
                ? <span aria-current={last ? 'page' : undefined}>{it.label}</span>
                : <Link href={it.href}>{it.label}</Link>}
              {!last && <span className="crumb-sep" aria-hidden="true">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
