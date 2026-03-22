// ManagedMediaSource 및 관련 이벤트 타입 정의
interface ManagedMediaSource extends MediaSource {
    readonly streaming: boolean;
    onstartstreaming: ((this: ManagedMediaSource, ev: Event) => never) | null;
    onendstreaming: ((this: ManagedMediaSource, ev: Event) => never) | null;
}

// 생성자 인터페이스
interface ManagedMediaSourceConstructor {
    new (): ManagedMediaSource;
    prototype: ManagedMediaSource;
}

// 전역 윈도우 객체에 추가
declare let ManagedMediaSource: ManagedMediaSourceConstructor;
