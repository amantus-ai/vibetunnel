function renderDetails(output) {
  return `<details>
<summary>Click to see details</summary>

\`\`\`
${output}
\`\`\`

</details>`;
}

function renderSection({ title, result, output }) {
  const icon = result === 'success' ? '✅' : '❌';
  const status = result === 'success' ? 'Passed' : 'Failed';
  let section = `### ${title} ${icon} **Status**: ${status}`;

  if (title.includes('Coverage')) {
    if (result === 'success' || (output && output.includes('%'))) {
      section += `\n\n${output}`;
    } else if (output && output !== 'No output') {
      section += `\n\n${renderDetails(output)}`;
    }
  } else if (result !== 'success' && output && output !== 'No output') {
    section += `\n\n${renderDetails(output)}`;
  }

  return section;
}

function isSectionHeading(line, title) {
  const sectionHeader = `### ${title}`;
  return (
    line === sectionHeader ||
    line.replace(/ [✅❌] \*\*Status\*\*: (Passed|Failed)$/, '') === sectionHeader
  );
}

function isReporterHeading(line) {
  return /^### .+ [✅❌] \*\*Status\*\*: (Passed|Failed)$/.test(line);
}

function upsertSection(existingBody, title, sectionContent) {
  const lines = existingBody.split('\n');
  const sectionStart = lines.findIndex((line) => isSectionHeading(line, title));

  if (sectionStart === -1) {
    return `${existingBody.trimEnd()}\n\n${sectionContent}`;
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (isReporterHeading(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  const replacement = sectionContent.trimEnd().split('\n');
  if (sectionEnd < lines.length) {
    replacement.push('');
  }

  return [...lines.slice(0, sectionStart), ...replacement, ...lines.slice(sectionEnd)].join('\n');
}

module.exports = {
  renderSection,
  upsertSection,
};
