'use client';
// Browser side of the single-document PDFs: read the company letterhead and who/where the document is for, then render.
import { getSupabase } from './supabaseClient';
import { logoAsJpeg } from './logoJpeg';
import { logoUrl } from './branding';
import { addressLine } from './format';
import { JOB_TYPES } from './format';
import { downloadBytes } from './photoReportClient';
import { renderInvoicePdf, renderEstimatePdf, invoiceFileName, estimateFileName } from './documentPdf';

// scope: { jobId } or { leadId }
async function loadInfo(scope) {
  const sb = getSupabase();
  const [{ data: s }, subject] = await Promise.all([
    sb.from('settings').select('business_name,phone,email,logo_path,invoice_footer').eq('id', 1).maybeSingle(),
    scope.jobId
      ? sb.from('jobs').select('job_number,job_type,customer:customers(display_name),address:addresses(street,unit,city,state,zip)').eq('id', scope.jobId).maybeSingle()
      : sb.from('leads').select('name,job_type,street,unit,city,state,zip').eq('id', scope.leadId).maybeSingle(),
  ]);
  const d = subject.data || {};
  const info = {
    business: s?.business_name || '', phone: s?.phone || '', email: s?.email || '', invoiceFooter: s?.invoice_footer || '',
    customer: scope.jobId ? d.customer?.display_name || '' : d.name || '',
    address: addressLine(scope.jobId ? d.address : d) || '',
    jobNumber: scope.jobId ? d.job_number : null,
    jobType: JOB_TYPES[d.job_type] || '',
  };
  const logo = await logoAsJpeg(logoUrl(s?.logo_path));
  if (logo) info.logo = logo;
  return info;
}

export async function downloadInvoicePdf(scope, invoice) {
  const sb = getSupabase();
  const [info, l, p] = await Promise.all([
    loadInfo(scope),
    sb.from('invoice_lines').select('*').eq('invoice_id', invoice.id).order('sort_order'),
    sb.from('payments').select('*').eq('invoice_id', invoice.id).order('received_at'),
  ]);
  const pdf = renderInvoicePdf({ info, invoice: { ...invoice, lines: l.data || [], payments: p.data || [] } });
  downloadBytes(pdf, invoiceFileName(info, invoice));
}

export async function downloadEstimatePdf(scope, estimate, lines) {
  const sb = getSupabase();
  const [info, sig] = await Promise.all([
    loadInfo(scope),
    sb.from('estimate_signatures').select('signer_name,signed_at').eq('estimate_id', estimate.id).order('signed_at', { ascending: false }).limit(1),
  ]);
  const pdf = renderEstimatePdf({ info, estimate, lines, signature: sig.data?.[0] || null });
  downloadBytes(pdf, estimateFileName(info));
}
