/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Reads progress emitted by a command; unknown output never becomes an invented percentage. */
export class TerminalTaskProgress {
	private _tail = '';
	private _duration: number | undefined;
	private _percent: number | undefined;

	update(output: string): void {
		this._tail = (this._tail + output).slice(-16384);
		const seconds = (hours: string, minutes: string, seconds: string) => Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
		for (const match of this._tail.matchAll(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g)) {
			this._duration = seconds(match[1], match[2], match[3]);
		}
		for (const line of this._tail.split(/[\r\n]/)) {
			const counts = /(?:^|\s)(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+(?:\.\d+)?)%\s*\)/.exec(line);
			if (counts && Number(counts[2]) > 0 && Number(counts[1]) <= Number(counts[2])) {
				this._percent = Number(counts[1]) / Number(counts[2]) * 100;
			}
			const time = /(?:\btime=|^out_time=)\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
			if (time && this._duration && this._duration > 0) {
				this._percent = Math.min(100, seconds(time[1], time[2], time[3]) / this._duration * 100);
			}
		}
	}

	get percent(): number | undefined { return this._percent; }

	estimatedRemainingSeconds(elapsedSeconds: number): number | undefined {
		return this._percent !== undefined && this._percent > 0 && this._percent < 100 && elapsedSeconds >= 5
			? Math.ceil(elapsedSeconds * (100 - this._percent) / this._percent) : undefined;
	}
}
